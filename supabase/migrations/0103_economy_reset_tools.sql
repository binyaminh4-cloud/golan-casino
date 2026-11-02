-- Preparation ONLY. Installing this migration does NOT reset or pause the economy.
-- A separate owner-only pause/reset/resume sequence is required.
begin;
create schema if not exists gc_economy;
revoke all on schema gc_economy from public,anon,authenticated;
create table if not exists gc_economy.control(
 id int primary key check(id=1),maintenance boolean not null default false,
 writer_tx bigint,batch text,reset_at timestamptz,finished_at timestamptz,
 wallet_cutoff bigint not null default 0,accounts int,verification jsonb
);
insert into gc_economy.control(id)values(1)on conflict do nothing;
create table if not exists gc_economy.backups(
 batch text not null,schema_name text not null,table_name text not null,
 saved_at timestamptz not null default clock_timestamp(),row_count bigint not null,
 data jsonb not null,primary key(batch,schema_name,table_name)
);
alter table gc_economy.control enable row level security;
alter table gc_economy.backups enable row level security;
revoke all on all tables in schema gc_economy from public,anon,authenticated;

create or replace function gc_economy.targets()returns setof regclass
language sql stable set search_path=pg_catalog as $$
 select c.oid::regclass from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and ((n.nspname='public' and c.relname=any(array['profiles','wallets','wallet_transactions','bank_accounts','bank_tx','loans','house_stats','poker_tables','poker_seats','poker_hands','poker_bots','tourneys','sl_free','sl_jackpots','bj_boost','bj_rounds','bjt_bets','bjt_rounds','dp_hands','dp_rounds','game_rounds','rl_live_bets','if_bets','pm_runs','ck_runs','f90_runs','job_runs','salary_claims','gc_level_seen','seasons','ch_points','ch_runs','ch_duels','zeus_duels','zeus_bets','sl_spins','pc_spins','kin_spins','ww_spins','dg_spins','rl_spins']))
 or n.nspname in('gx','zlm_private')) order by n.nspname,c.relname
$$;
-- Statement guards run before rows are touched. Requests started before the
-- reset must retry; they cannot apply a stale hand or payout after maintenance.
create or replace function gc_economy.guard()returns trigger language plpgsql
security definer set search_path=pg_catalog,gc_economy as $$
declare c gc_economy.control;
begin
 select * into c from gc_economy.control where id=1;
 if c.writer_tx is distinct from txid_current() then
  if c.maintenance then raise exception 'economy_maintenance';end if;
  if c.reset_at is not null and transaction_timestamp()<=c.reset_at then raise exception 'economy_request_expired_retry';end if;
 end if;
 return null;
end $$;
do $setup$
declare t regclass;
begin
 for t in select gc_economy.targets() loop
  execute format('drop trigger if exists gc_economy_guard on %s',t);
  execute format('create trigger gc_economy_guard before insert or update or delete or truncate on %s for each statement execute function gc_economy.guard()',t);
 end loop;
end $setup$;

alter table public.bank_tx drop constraint if exists bank_tx_kind_check;
alter table public.bank_tx add constraint bank_tx_kind_check check(kind in(
 'salary_weekly','salary_monthly','gift','deposit','withdraw','job','levelup',
 'loan_in','loan_repay','loan_out','loan_back','loan_cancel','exchange_lock','exchange_return','economy_reset'));

create or replace function gc_economy.pause()returns text language plpgsql set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from gc_economy.control where id=1 and finished_at is not null) then return 'ALREADY COMPLETED: pause skipped';end if;
 update gc_economy.control set maintenance=true,writer_tx=null where id=1;
 return 'PAUSED: financial writes blocked; no balances reset';
end $$;

create or replace function gc_economy.cancel_pause()returns text language plpgsql set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from gc_economy.control where id=1 and reset_at is not null) then raise exception 'reset_already_applied_use_resume';end if;
 update gc_economy.control set maintenance=false,writer_tx=null where id=1;
 return 'UNPAUSED: reset was not applied';
end $$;

create or replace function gc_economy.verify()returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare c gc_economy.control;bad int;claims int;h public.house_stats;saved boolean;
begin
 select * into c from gc_economy.control where id=1;
 select count(*) into bad from public.profiles p left join public.wallets w on w.user_id=p.id
 left join public.bank_accounts b on b.user_id=p.id where w.balance is distinct from 0::bigint or b.balance is distinct from 50000000::bigint;
 select
  (select count(*) from public.poker_seats s where exists(select 1 from public.profiles p where p.id=s.user_id))+
  (select count(*) from public.poker_hands where players<>'{}'::jsonb or street not in('idle','done'))+
  (select count(*) from public.loans where status in('offer','active','late'))+
  (select count(*) from gx.positions where status<>'closed')+
  (select count(*) from public.sl_free where left_spins<>0)+
  (select count(*) from public.bj_boost)+
  (select count(*) from public.job_runs where not done)+
  (select count(*) from public.pm_runs where phase in('playing','checkpoint'))+
  (select count(*) from public.ck_runs where status='active')+
  (select count(*) from public.f90_runs where status='active')+
  (select count(*) from public.game_rounds where status='open')+
  (select count(*) from public.bj_rounds where status<>'done')+
  (select count(*) from public.dp_hands where status<>'done')+
  (select count(*) from public.bjt_rounds where phase<>'done')+
  (select count(*) from public.dp_rounds where phase<>'done')+
  (select count(*) from public.rl_live_bets where not settled)+
  (select count(*) from public.if_bets where not settled)+
  (select count(*) from zlm_private.bets where not settled)+
  (select count(*) from public.tourneys where status in('registering','running'))+
  (select count(*) from public.ch_runs where status<>'done')+
  (select count(*) from public.ch_duels where status not in('done','expired'))+
  (select count(*) from public.zeus_duels where status in('invited','active'))+
  (select count(*) from public.zeus_bets where not settled)+
  (select count(*) from public.seasons where not settled and starts_at<c.reset_at)
 into claims;
 select * into h from public.house_stats where id=1;
 select count(*)=(select count(*)from gc_economy.targets()) and coalesce(bool_and(row_count=jsonb_array_length(data)),false)
 into saved from gc_economy.backups where batch=c.batch;
 return jsonb_build_object('result',case when c.finished_at is not null and bad=0 and claims=0 and h.total=0 and saved then 'PASS' else 'FAIL' end,
 'accounts',(select count(*) from public.profiles),'incorrect_accounts',bad,'outstanding_claims',claims,
 'wallet_total',(select sum(balance::numeric)::text from public.wallets),
 'bank_total',(select sum(balance::numeric)::text from public.bank_accounts),
 'house',h.total,'maintenance',c.maintenance,'batch',c.batch,'snapshot_complete',saved,
 'backups',(select count(*) from gc_economy.backups where batch=c.batch));
end $$;

create or replace function gc_economy.check_definitions()returns void language plpgsql set search_path=pg_catalog,public as $$
declare r record;
begin
 for r in select * from (values
 ('gx','bank_event','tx bank_tx','708f050749a8ca996eb059380ef8eed6'),
 ('gx','credit','p uuid','235aef5a8af4827afa5eb491142b673f'),
 ('gx','daily','d date','848df8a82687beee4052093ba39a14db'),
 ('gx','finish','p uuid, price numeric, why text','050ef19eebd51d42da49a4354fc41978'),
 ('gx','fund_touch','u uuid, t timestamp with time zone','037875161a9d0b9359acc6d5785fc50c'),
 ('gx','game_feed','','acb09576a2df0b42211ff80aef137f25'),
 ('gx','poker_feed','','fd325e0942e1df051305084194813104'),
 ('gx','publish','c text, u uuid, p numeric, t timestamp with time zone, effective timestamp with time zone','cad450c8fb40d0d9196023d1b7fc5fa0'),
 ('gx','require_worker','','2c58a03b67d5311676c39a3e54558cdd'),
 ('gx','tick','','4a4db533b24607c1e3f5a44ad5948056'),
 ('gx','value','stake numeric, lev integer, direction integer, entry numeric, price numeric','de3c90657c58dbc42205f9ee15db680b'),
 ('gx','worker_ready','','505d5685475682002e3baec2995f5e4c'),
 ('public','admin_clear_chat','','05e6f2657827dac34582f2e2b0e8be43'),
 ('public','admin_grant','p_user uuid, p_amount bigint','452ecaf61198790264c0c8451c78cb35'),
 ('public','admin_issue_code','p_username text','d62697f92a4653cc0d7f37ec6ee5dcde'),
 ('public','admin_members','','5f17e3a17d589ff1949b84614fa795d3'),
 ('public','admin_pending_codes','','59561b842e47a5deb2e6bead7b9153c6'),
 ('public','admin_rename','p_user uuid, p_name text','cbf0c66ccb348765fa76d9e5e23f3617'),
 ('public','admin_season_restart','','df863d5622d14fed3148953a352433ac'),
 ('public','admin_set','p_key text, p_value jsonb','f5c3186b54d56903e2cdd17bcd106e15'),
 ('public','admin_set_character','p_user uuid, p_key text','ab973241be03aa1576aefe99b0baecc6'),
 ('public','admin_settings','','422881fa9aef42d0afff75a0a6d51db5'),
 ('public','apply_tx','p_user uuid, p_game text, p_kind text, p_amount bigint, p_ref text','1d2c5031198ac5a08883f3957254deb8'),
 ('public','bank_add','p_user uuid, p_kind text, p_amount bigint, p_ref text','2efbb42414318cf80c90efc31111de86'),
 ('public','bank_bal','p_user uuid','dd5f5f4d828427f1172419ebc38e97cf'),
 ('public','bank_move','p_amount bigint, p_dir text, p_ref text','d954cfec8477fceb801f5fbee61a8535'),
 ('public','bank_state','','2b1dd9c0c9924b784cca176c3eafbce1'),
 ('public','bj_action','p_round uuid, p_action text','0bdc88ba931e911f32f443f6abfc43bb'),
 ('public','bj_advance','p_round uuid','1c78a6b57bc156a32561a47ebc510f05'),
 ('public','bj_bust_mult','n integer','7da18a5d762cdaa669b0ee0b7fe2c111'),
 ('public','bj_current','','4a58b84bed61b5a62e0f2bce7c49c0d1'),
 ('public','bj_deal','p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text, p_mode text, p_run uuid','35f6816c2749eafc7c7280bc36fcaf21'),
 ('public','bj_draw','p_user uuid','eb1f12bdfeb7bd73ab92cbc682d97eb7'),
 ('public','bj_finish','p_round uuid','6d8ef0c45c5de3cda8e2609bf1aff15d'),
 ('public','bj_fpick','p_kind text','446bd6dcdb2e1dc27926b87c3cea184b'),
 ('public','bj_hand_mult','p_cards jsonb, p_strikes jsonb','dd60a925ed9bdfaa2924b649c1d8289f'),
 ('public','bj_hand_value','p_cards jsonb','228248ca22db23cc9e7755abb5345063'),
 ('public','bj_hold','p_round uuid','258e6022e02888a2992221eb00d459ad'),
 ('public','bj_is_bj','cards text[]','b9169fac8b13b9fb1597b9cd6cbd4b30'),
 ('public','bj_jcards','j jsonb','9d42d1cb9d17391bb2627566f3920840'),
 ('public','bj_ll','a text, b text, dealer_bj boolean','3fc190ac77972ec55516966f265812b1'),
 ('public','bj_lpick','p_tier text','ce9760e47b08bd7d7b5593ddd41a223f'),
 ('public','bj_my_boost','','1447c2919e956050313ddab772be9481'),
 ('public','bj_pp','a text, b text','61c2d207a716eeed8a6920e32b4c6c1f'),
 ('public','bj_strikes','','f7041615cf953749a6a0b4bfaa08aa5d'),
 ('public','bj_t3','a text, b text, c text','aef5516ba90876f9b9f5c165462c612b'),
 ('public','bj_total','cards text[]','023363e84afff541dc51a3f9eac793ec'),
 ('public','bj_tx','p_user uuid, p_game text, p_kind text, p_amount bigint, p_ref text','db60117ca98807f418d05eafbba82001'),
 ('public','bj_val','c text','9ba14490dbab60db3cfb9ed0e01a1a87'),
 ('public','bj_view','p_round uuid','979096422417b7a5c9fa4d8a26d60b08'),
 ('public','bjt_bet','p_t integer, p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text','c90d4badd63458e31943e84449184262'),
 ('public','bjt_deal','p_t integer, p_n bigint','65592c94dfd5385aa721b9ebb17d0933'),
 ('public','bjt_resolve','p_t integer, p_n bigint','e2a3dc512820e18c4a4c9129920ba960'),
 ('public','bjt_state','p_t integer','8a5ec8c9324b28962f4468c6537e3503'),
 ('public','bjt_tick','p_t integer','f60385038d6cbfab04b4810760ede088'),
 ('public','bus_finish','p_id uuid, p_ok integer, p_perfect integer, p_hits integer','8be0371e8a097b8f9672ccac5ba4452d'),
 ('public','bus_rate','p_level integer','de98bd203b9f282e490cb33bf94eedb3'),
 ('public','bus_start','p_level integer','7382d1e2103de4ed943b7a3c0d30d049'),
 ('public','ch_accept_ido','p_duel uuid','7bcc19fd157da88c48bacf616af7a6c4'),
 ('public','ch_add_points','p_season integer, p_user uuid, p_kind text, p_pts integer','d8bc3c71e5f7b40cabd3a014d744bbf9'),
 ('public','ch_challenge_ido','p_opponent uuid','046a71021892697afd92fbade3dc70af'),
 ('public','ch_finish_run','p_run uuid','4b88ea427d1ebace240f44be64e5200b'),
 ('public','ch_hand_done','p_run uuid','10ae398f002a0e0e25183168de91bc4d'),
 ('public','ch_new_deck','','aa1733bd8dfb45ee2fe96cdcbc8fc05f'),
 ('public','ch_run_info','p_run uuid','a1bda6a3b2f7bf84c4d4160d94370c98'),
 ('public','ch_runs_5','','8a56e1ee87cef6deb13f95fde1019807'),
 ('public','ch_season','','19974a2117de59e8e066be3ee6ccb7d9'),
 ('public','ch_settle','','d5aef119d19461e8af2626bd5c861d74'),
 ('public','ch_start_fisher','','1ab570f8bfd3267388b67c6beecb0448'),
 ('public','ch_state','','35173233e99ce16a5002d18bfa0415a7'),
 ('public','ch_vault','p_season integer','bc1716ebd46a9c155d716841a7e1b941'),
 ('public','chat_send','p_room text, p_body text','e3940cb6a91ddb528293dc0a29308307'),
 ('public','chat_since','p_room text, p_after bigint, p_where text','3244ca4bfde539f7d12c1dff1ee98a07'),
 ('public','chat_sys','p_room text, p_body text','824ae383567fbcd29627f62ec444d383'),
 ('public','ck_advance','r ck_runs','cedb7921d74c1ada42f4f82b30600f37'),
 ('public','ck_cash','p_run uuid','7edbeb6b50297d18be39b63c01c559e4'),
 ('public','ck_current','','602284c3342522d315a55a522e7e9002'),
 ('public','ck_start','p_stake bigint, p_mode text, p_ref text','2e9dcb0cb11c9207f345facbcb156b6e'),
 ('public','ck_step','p_run uuid, p_from integer','9961abd12401b90fabd63a5b1d78b5b4'),
 ('public','ck_table','p_mode text','b924fcbec2243d398fc8599e4f95d257'),
 ('public','ck_view','r ck_runs','027b740a01f64761edd66f4fea62c03e'),
 ('public','dg_buy','p_stake bigint, p_ref text','c71e8904fdb6b53634a2c6a1c2774964'),
 ('public','dg_spin','p_stake bigint, p_ref text','d11cc108980d6309503f355362aa21f3'),
 ('public','dp_act','p_round uuid, p_action text','8b59e7b9b27465c0d1f8365ea46ff0e5'),
 ('public','dp_best7','c text[]','97ef2f547598527630b21be80e4da2ed'),
 ('public','dp_bet','p_game text, p_t integer, p_ante bigint, p_side bigint, p_ref text','539a701b9ef9cb0b0461b1941f72ce35'),
 ('public','dp_cat','score bigint','fd258d837f84a593228eb591606d4057'),
 ('public','dp_deal','p_round uuid','be9acfcf4bc039ef629624f31e5afc8f'),
 ('public','dp_deck','','a87802f4ac19d7e2307dd1a898db0973'),
 ('public','dp_draw','p_round uuid, n integer','691b67101d2914fa888ad7552e3aff55'),
 ('public','dp_eval3','c text[]','66aeb82b5e243eb980e2d2f3d7f917cb'),
 ('public','dp_eval5','c text[]','ab100f282b7af9c6b857428fb8f4e713'),
 ('public','dp_next','p_round uuid','00127995703d006c190a096f166e7857'),
 ('public','dp_rank','c text','d411a8b95620e895aee7a7e43e67d262'),
 ('public','dp_settle','p_hand uuid','51af63bf38f5cd6ed6ae92b6513216f5'),
 ('public','dp_state','p_game text, p_t integer','700e4caf998b66ab9f24be6973ad6d95'),
 ('public','dp_tick','p_game text','bbbbcbbac4f5b1506dc074e7b7f67831'),
 ('public','dp_view','p_round uuid','7f05742cfaacf2f1466ad190befb24cd'),
 ('public','drv_best','p_stops jsonb, p_x integer, p_y integer, p_mask integer, p_n integer','d409a2d257a7e73c3d1afe118aee9a46'),
 ('public','exchange_close','p_position uuid','0a1b12d83d827ccda9b3ea22df859026'),
 ('public','exchange_history','p_before timestamp with time zone, p_before_id uuid','85c894c9232b832bd0e3ddec5761cc88'),
 ('public','exchange_open','p_code text, p_direction integer, p_amount bigint, p_leverage integer, p_days integer, p_request uuid','1084c9d345787f9ebdcb188df4057285'),
 ('public','exchange_ready','','16b5769c56ba4476a6d981bc8e93af67'),
 ('public','exchange_state','p_code text, p_hours integer','396d9e19dc68b066719f8c9eaba2cb9a'),
 ('public','exchange_wealth','p_user uuid','7f45225a481c2453435477b487277c62'),
 ('public','f90_act','p_run uuid, p_action text','fb3cba5f35709c5b9245766df39b84bc'),
 ('public','f90_action','p_stage integer, p_id text','5c706452d6263ebb6579230e5d8a1cb1'),
 ('public','f90_amount','p_stake bigint, n bigint, d bigint','9a7e7c140924942076ccb5b26eb70cc2'),
 ('public','f90_cash','p_run uuid','d0ff0fe6917bec189cefb32a7b1ddf01'),
 ('public','f90_current','','49494653cbfe6a347a1848bfa5fb4998'),
 ('public','f90_start','p_stake bigint, p_ref text','a45ab9a3b91c84d6a6ae9caf574a8568'),
 ('public','f90_view','r f90_runs','92eb9a38df2cf1e5a0457c1b270d972e'),
 ('public','fiber_finish','p_id uuid, p_ok integer','c5cef37f83b742b71aca79539785b1cd'),
 ('public','fiber_rate','p_level integer','4b36041f6cfbf7ab0970301c4dddca0c'),
 ('public','fiber_start','p_level integer','f975622f8da52255aaa5aaf077beb9bb'),
 ('public','fish_finish','p_id uuid, p_color integer, p_silver integer, p_gold integer, p_casts integer','847da104976442fac536832fded9f07d'),
 ('public','fish_start','p_level integer','4733f2a32f2f91e942278f50c7eb6d67'),
 ('public','fish_vals','p_level integer','d11eb150986054594cbe02ec1aea33b4'),
 ('public','fo_buy','p_line_bet bigint, p_ref text','40276885971d1dc1b8a22bdccac2fc36'),
 ('public','fo_eval','p_stops integer[]','2e3d0d500876867864eb507dff11f694'),
 ('public','fo_free_left','','d93f2d768df1323d7dd41a643e90f617'),
 ('public','fo_line','a text, b text, c text','92a695a886e2c1506238f51bdb6857ec'),
 ('public','fo_pay3','sym text','218e6bb2f3912e2bbefd73c6874b3d03'),
 ('public','fo_spin','p_line_bet bigint, p_ref text','0dcede68a370940666a9d54b4e88ee44'),
 ('public','fo_state','','b09e380247ac38fc534509f2113eee0d'),
 ('public','fo_stop','','8131f8aa39d99c5e08058a5aa154ba7d'),
 ('public','fo_strip','','bcd8cd164ac707aa9242afc76297d99f'),
 ('public','gc_buy_price','p_game text, p_kind text','edb814701ccf0336d1a7e275d8117d96'),
 ('public','gc_buy_prices','','d4277922e3c8b30d1a8a7987b3f910f4'),
 ('public','gc_fav_games','','d574018ae99798fa93380de20bba67d3'),
 ('public','gc_friend_locations','','221db89995f9c9b557e1b7a19983d8d5'),
 ('public','gc_is_admin','','4c6b3d2d616876d58ec5a64885e2a184'),
 ('public','gc_is_test','p_user uuid','c9b84dabbc59ea8874f276d0aa34aec3'),
 ('public','gc_job_mult','','3454b7f1133b5d0ece44dd234755bb97'),
 ('public','gc_level_check','','f9b76f20474c38e152b2d18972c31175'),
 ('public','gc_level_info','p_user uuid','94b1a94634982561e760e52883a96fb6'),
 ('public','gc_levels','','3a104a42396b9ca4cca62b40a2889051'),
 ('public','gc_live','','0ac4e73ebc3d85026a36cf5576dd67a6'),
 ('public','gc_max_bet','p_user uuid','3587f69bed5dffde12b0f8e23e93c624'),
 ('public','gc_max_for','p_bal numeric','81d3eaffd9fdb3b37b4a74554c3ad18d'),
 ('public','gc_motzash','p_day date','c13460ab09b0b9f14499f6e2c7160693'),
 ('public','gc_my_level','','d56c16248e1ecb7732919a449be03038'),
 ('public','gc_my_max_bet','','0e9e1d831f0c16bc09c67048b6954589'),
 ('public','gc_norm','u text','ca1f830f0f442b110c8c38879c40c372'),
 ('public','gc_num','p_key text','876cff2362399cd6d3f02e30fc7cd3ae'),
 ('public','gc_on','p_key text','ecbb58e88f8a8c01e7edfb28ef174f83'),
 ('public','gc_online','','a8a13e5a2c1f8d8d4082b7cacc796978'),
 ('public','gc_public','','d4e40acb369660adc9d66e2c70f92e22'),
 ('public','gc_set_password','p_password text','9c17d208d49c5403a012c7e5b5c2a9a3'),
 ('public','gc_shabbat_until','','17e7261c9b9c9bc918fc4a33429c70a8'),
 ('public','gc_top_check','','08c75d32972465783236e75d84b93594'),
 ('public','handle_new_user','','a2eda615a015671cc04bef8e164c29df'),
 ('public','house_stats','','550685f965ddb2607e404a465d60bb3b'),
 ('public','if_bet','p_round bigint, p_bets jsonb, p_ref text','279e6f01ac7fd0c966fe0357aba3544d'),
 ('public','if_bonus_secs','p_total integer','73e6014a351f3d7531c9a20898d350c8'),
 ('public','if_current','','1a836902b81728f49a0d653b3f167d53'),
 ('public','if_gross','p_bets jsonb, r if_rounds','4dde59656980d1e8efc0a148553d574f'),
 ('public','if_layout','','77fb1fa2482e5fbe908ee905e8574381'),
 ('public','if_make','p_round bigint, p_start numeric','c0cd313872df415a04c5243cd433cb55'),
 ('public','if_pick','p_vals integer[], p_w integer[]','4466c5e5fdb58e17242ae3ae64f0bfda'),
 ('public','if_segmult','r if_rounds','d4a2f4beb7d2bfd9e3bde1a4147eddce'),
 ('public','if_settle','','8750e452e57aa4c39200f200823ded25'),
 ('public','if_state','','53100d0778f5446a74e10a6f281e21ac'),
 ('public','job_card','','ea89ffad28871623b3e0767e8594221e'),
 ('public','job_finish','p_id uuid, p_answer jsonb','1134aa4c0c2795bc25e839f70d867bd4'),
 ('public','job_pay','p_game text, p_level integer','e9ea67d1ec7821b94eb1dc9fdb174829'),
 ('public','job_secs','p_game text, p_level integer','2038596b33b4aa246388619f5de3dda6'),
 ('public','job_start','p_game text, p_level integer','9b446357b0e1f977ecc93afd7eb0de4c'),
 ('public','kin_buy','p_stake bigint, p_ref text','b9faea220e179f1bcfe65b7d40746345'),
 ('public','kin_spin','p_stake bigint, p_ref text','bea08e8c8dac109242bdefe76617cf11'),
 ('public','loan_accept','p_loan uuid','12ba0eaa3295220ce496d7355bec4366'),
 ('public','loan_apply','p_loan uuid, p_amount bigint, p_ref text','a77845f8ea80cc61cab5059f7e4fb521'),
 ('public','loan_bank_take','p_track text, p_amount bigint','0122edf7136c30f33265562f78fe27b6'),
 ('public','loan_cancel','p_loan uuid','63fd9aa33495e00f7ab329c2a72e8912'),
 ('public','loan_debt','p_user uuid','c909e3dc35a6cd3e9c4941d13ad069ce'),
 ('public','loan_late','p_user uuid','790e46ce2fabf571197d6132eca898ca'),
 ('public','loan_lent','p_user uuid','9b5518a8334d9cdee7fb174ca085443b'),
 ('public','loan_offer','p_amount bigint, p_rate integer, p_days integer, p_to uuid','bc6de0c260aa3edd70e348af87df5a0e'),
 ('public','loan_pay_all','p_user uuid, p_amount bigint, p_ref text','5a7a42e7d6aea70b016297816f80ec63'),
 ('public','loan_repay','p_loan uuid, p_amount bigint','fbcec5b33a26e5ae5cca7294eed071d8'),
 ('public','loan_tick','','1ea9f620f1299b7cc37f49aed90c2de9'),
 ('public','loan_tracks','','5a97ad8a9c5f4ec3799f45f4578ebc1e'),
 ('public','loans_state','','14d1373ec0071adada68dde10d867a8b'),
 ('public','login_email','p_username text','dc910b983d3b3c1edcb4e8de0ce9e111'),
 ('public','open_round','p_user uuid, p_game text, p_stake bigint, p_ref text','454899ff58a02841ff09ca7397373d89'),
 ('public','pb_act','p_table uuid','f2d88072e8eeefe2389dadebffb09d0b'),
 ('public','pb_blinds','','bc4be46932159ec7d7d0c125a9bc8ba1'),
 ('public','pb_is_bot','p uuid','8518bb0143eac82b27fef45f6aac3516'),
 ('public','pb_strength','hole text[], board text[]','e3055c544b00a2d6b414677f2548001b'),
 ('public','pc_buy','p_kind text, p_stake bigint, p_ref text','2b50e39282a8a01346ecfef635e93bdb'),
 ('public','pc_pick','w numeric[]','c69d28fd05b18451afb5a4f0c6f1e23e'),
 ('public','pc_spin','p_stake bigint, p_ref text','8a044058a9f8e15f87cc89db1d17f4c6'),
 ('public','ph_advance','p_table uuid','a26d7d3e0724a126e627284405655daa'),
 ('public','ph_apply','p_table uuid, p_seat integer, p_action text, p_amount bigint','c49db5bbdf8dad6c6a3f5c1c3584ee93'),
 ('public','ph_best','c text[]','30e7f645c732149ee5e62291d4143d97'),
 ('public','ph_cat_name','v bigint','b879892d4ddce8151cc16533f354b92e'),
 ('public','ph_count','p jsonb, p_kind text','acb7de8be8c70e0cb0bacba6683ccb68'),
 ('public','ph_eval5','c text[]','a3a6761a731523d241968e2cd882e675'),
 ('public','ph_next','p jsonb, p_from integer, p_kind text','c3990b3bbe1d110080bd4cce55e6ad06'),
 ('public','ph_put','p jsonb, p_seat integer, p_amt bigint','1eeae1c2430e4369db119b0d43e8548a'),
 ('public','ph_rank','c text','d411a8b95620e895aee7a7e43e67d262'),
 ('public','ph_seats','p jsonb','d95b396e9d2c7df3c92d0488d21fd65d'),
 ('public','ph_showdown','p_table uuid','a1aabbde70ca8fa30f6955c13e651049'),
 ('public','ph_start','p_table uuid','1b0b0c489311c4007243b48d59d2cf4f'),
 ('public','pm_cfg','','4427696ba4165436b3c99d986a251479'),
 ('public','pm_choose','w jsonb','452c9710cdb4cd6f48d3fe5d84be585a'),
 ('public','pm_collect','p_run uuid, p_rock integer','b327a2e2a6e5d64abc24a0ac2e7a8fa4'),
 ('public','pm_current','','2fd2eebb95ca5cd536b4ea7df4e5c5f7'),
 ('public','pm_make','p_mode text','1085f69b91496c36930723f421de5139'),
 ('public','pm_next','p_run uuid, p_cash boolean','602d803aa0ba7b6f5c5d8a5ea349f181'),
 ('public','pm_reward_units','p_mode text, p_successes integer, p_units bigint','7c3c8d28b3f3e0b32f61378adc789dbd'),
 ('public','pm_start','p_stake bigint, p_mode text, p_ref text','d4a73d6178a00e18d50d1ccdeabf528e'),
 ('public','pm_view','r pm_runs','045ca8e7291a0b19275958b46ae34a95'),
 ('public','poker_act','p_table uuid, p_action text, p_amount bigint, p_hand bigint','b26eb1a6ef879b8b895aa18a0c3a7ba3'),
 ('public','poker_bot_shared','p_bb bigint','45bd22c73c1630b7898e6f2e5f785759'),
 ('public','poker_bot_table','p_bb bigint','88e38370a065510d847a6a568fc381a2'),
 ('public','poker_buyin','p_user uuid, p_table uuid, p_seat integer, p_amount bigint, p_ref text','d50df19cf7a1b64b57c661e7cfa65f74'),
 ('public','poker_cash_leave','p_table uuid','03696491ea321d8852b442ee999cac5e'),
 ('public','poker_cashout','p_table uuid, p_user uuid, p_ref text','0b9991b28be13ab5146c9c19aed71e49'),
 ('public','poker_expire_table','p_table uuid','72ee69eecdba63a248b13d6606cfc3e6'),
 ('public','poker_friends_table','p_bb bigint','b6850e740e9251bfac7cb0d745f0c734'),
 ('public','poker_leave','p_table uuid','6e9e33ff6a52622697eefacb346254e9'),
 ('public','poker_my_tables','','7a64cbad21fc8551dd903b5fc9910f02'),
 ('public','poker_presence_sweep','','0b3298eb10136984e7aa74375aac5e15'),
 ('public','poker_sit','p_table uuid, p_seat integer, p_amount bigint','74707436029176f6ff1752efc3a65a1b'),
 ('public','poker_state','p_table uuid','c1d122f8acf824977b7e63acb335d873'),
 ('public','poker_tables_list','','032101a30907deac776887d034ccf5f2'),
 ('public','poker_tick','p_table uuid','98fcd53325fff52727a2bfbd1f4fc5e0'),
 ('public','poker_touch','p_table uuid','1cf7fb5da23f7f394767a8fe89242e8b'),
 ('public','redeem_code','p_username text, p_code text, p_password text','9a2ed2948744ddddf012a444e228da23'),
 ('public','rl_clean_bets','p_bets jsonb','32909c1cda3d4e18efbe1b6422389220'),
 ('public','rl_history','p_mode text','3a6e6a0a8d65292326dc8ff9a87da535'),
 ('public','rl_live_bet','p_round bigint, p_mode text, p_bets jsonb, p_ref text','f9c97c5e5c1ef0ec57b44bac12da3fb4'),
 ('public','rl_live_cycle','','32134ba53d8b75d6c1e759847a4528e9'),
 ('public','rl_live_ensure','p_round bigint','8e41400cd9c9c542c9fa1960a60ee84e'),
 ('public','rl_live_now','','cc6ca231730bb0a0d0addf041e604c1a'),
 ('public','rl_live_recent','p_mode text, p_limit integer','6a73a615837a8b66d74461e767cf0737'),
 ('public','rl_live_settle','','50b256e11d516c34e71785d6ac6eee68'),
 ('public','rl_live_state','p_mode text','c8b3a1d0ef8bbc13de68c09e51d5818e'),
 ('public','rl_live_window','','f6370dce226e079fd316002e260ed3b0'),
 ('public','rl_pay','p_bets jsonb, p_result integer','2854b38460b25b1a5c317c214b2a4d2f'),
 ('public','rl_pay2','p_bets jsonb, p_result integer, p_mode text, p_lucky jsonb','655ff56bfbfbcace6cf99f7a682beba8'),
 ('public','rl_pick','p_kind text','5f8feb2574b17eb8de087c8889d7b03c'),
 ('public','rl_rand37','','b209b30d4f32c5f96f463a4239fba990'),
 ('public','rl_randint','n integer','15513357ac387643b43231963944dcab'),
 ('public','rl_spin','p_bets jsonb, p_ref text, p_mode text','4ff49d1368840761a27b13028752b483'),
 ('public','rl_strike','p_mode text','7c879c1267d8503b86b72e9ed58479d9'),
 ('public','salary_claim','','e18b2bcfa55f4b46485b650bc6a649b8'),
 ('public','seed_buy','p_game text, p_kind text, p_stake bigint, p_ref text','19bb33facf4dd3718726d9412844b374'),
 ('public','settle_round','p_round uuid, p_payout bigint','9937a5d1cc874dfc6a703109bd40e2f3'),
 ('public','sl_eval','p_stops integer[]','e6a4d17dd15669ac76737e4635b2878d'),
 ('public','sl_line','a text, b text, c text','2b54ebcd7ad62cdfd97391ef0f8e70d3'),
 ('public','sl_pay3','sym text','76374395400a30c7191b93359c4a2225'),
 ('public','sl_spin','p_line_bet bigint, p_ref text','4fc7d483b4e91b72c67c603a1dcdeaae'),
 ('public','sl_strip','','146f60de56adad2a88ab68f0cbb7389d'),
 ('public','tamer_finish','p_id uuid, p_plain integer, p_engraved integer, p_rare integer, p_drops integer, p_bombs integer, p_spiky integer','8359667d0fb32659427a61e6590eb137'),
 ('public','tamer_start','p_level integer','d32827af31d029bc9dfaff46b02f63f5'),
 ('public','tn_between_hands','p_table uuid','039bb13f3e3e15e220389ddaf88160a3'),
 ('public','tn_blinds','p_level integer','4ebb29b573c6056f013d4fa18d16b709'),
 ('public','tn_wheel','','2b70990571a2ef26aa970ff59ba0c2e3'),
 ('public','tourney_join','','9c15a1b30d2528ae67d3130cd1828139'),
 ('public','tourney_leave','','35c94b716396471eabc1446a6a6677f4'),
 ('public','ww_buy','p_kind text, p_stake bigint, p_ref text','67b62d634428e7d5b77115f350d52a06'),
 ('public','ww_spin','p_stake bigint, p_ref text','731f85be64b9de7db95cbee763cc4b31'),
 ('public','zeus_answer','p_duel uuid, p_accept boolean','521d373c46e37e1cf059678c33aaedbd'),
 ('public','zeus_bet','p_duel uuid, p_round bigint, p_bets jsonb, p_ref text','fe530db1dbbca4975b8cc9c1babf0efd'),
 ('public','zeus_cancel','p_duel uuid','ab3c03ed7fdd97939c06e4a439486231'),
 ('public','zeus_invite','p_opponent uuid','9fe004a5a161b67b9cbc6eb5f2708ea1'),
 ('public','zeus_list','','5beb71145c468ad306e254c3a9cc409a'),
 ('public','zeus_rounds','','68c02e318f650f5efb78cbfa1c972995'),
 ('public','zeus_settle','p_duel uuid','7dcda82334c5ea76e92c1a98873a30c9'),
 ('public','zeus_state','p_duel uuid','26ef7ed8fda2c83c7de2e66d6829d59f'),
 ('public','zlm_bet','p_round uuid, p_spot text, p_amount bigint, p_request uuid','4e0cf2933204de4e000680011546e894'),
 ('public','zlm_bet_batch','p_round uuid, p_layout jsonb, p_request uuid','b875d73e2c28d02cc7d7471b91d04c86'),
 ('public','zlm_choose','p_round uuid, p_pick integer','4f3558ed264fc085119f0e9f21109d7d'),
 ('public','zlm_ready','','2224ee6debc8b23d5ecbd229e550650b'),
 ('public','zlm_repeat_ready','','2224ee6debc8b23d5ecbd229e550650b'),
 ('public','zlm_state','','3464c37c5efda725ecd642f3b9b56416'),
 ('zlm_private','balls_result','deck integer[], count_drawn integer','de4c8efef045e9ac388f4310d442d0d2'),
 ('zlm_private','shuffle','a integer[]','f81076cfe4c977f242ff2e636bcf4a16'),
 ('zlm_private','spots','','b03e5c1ed000bf231e67453df30f020d'),
 ('zlm_private','tick','wake boolean','60b98fa96e8860a06ea7664bda4f1fe3'),
 ('zlm_private','weighted','vals integer[], weights integer[], excluded integer[]','e783d7b42a4587f332bfa4c66dd83c74')
 )v(schema_name,fn,args,hash) loop
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname=r.schema_name and p.proname=r.fn and pg_get_function_identity_arguments(p.oid)=r.args
   and md5(replace(p.prosrc,chr(13),''))=r.hash) then raise exception 'unexpected_installed_definition: %.% (%)',r.schema_name,r.fn,r.args;end if;
 end loop;
end $$;

create or replace function gc_economy.reset_once()returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare c gc_economy.control;t regclass;r record;nsp text;rel text;j jsonb;cnt bigint;at_ timestamptz;
 batch_ constant text:='golan-economy-2026-11-reset-50m-v1';d date;lv int;
begin
 perform pg_advisory_xact_lock(hashtext('golan_economy_reset'));
 select * into c from gc_economy.control where id=1 for update;
 if c.finished_at is not null then return jsonb_build_object('already_done',true,'maintenance',c.maintenance,'original_verification',c.verification);end if;
 if not c.maintenance then raise exception 'pause_required';end if;
 if c.batch is not null then raise exception 'unexpected_reset_state';end if;
 perform set_config('lock_timeout','5s',true);
 -- Lock the complete write surface before taking the snapshot. Any failure rolls
 -- this transaction back, leaving maintenance active and balances unchanged.
 for t in select gc_economy.targets() loop execute format('lock table %s in access exclusive mode',t);end loop;
 -- Require the tested slot patch, never reset first and install its fix later.
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.dg_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='d11cc108980d6309503f355362aa21f3')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.kin_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='bea08e8c8dac109242bdefe76617cf11')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.ww_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='731f85be64b9de7db95cbee763cc4b31')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.pc_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='8a044058a9f8e15f87cc89db1d17f4c6')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.fo_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='0dcede68a370940666a9d54b4e88ee44') then raise exception 'install_verified_0102_first';end if;
 perform gc_economy.check_definitions();
 for t in select gc_economy.targets() loop
  select ns.nspname,cl.relname into nsp,rel from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where cl.oid=t;
  execute format('select count(*),coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from %s x',t) into cnt,j;
  insert into gc_economy.backups(batch,schema_name,table_name,row_count,data)values(batch_,nsp,rel,cnt,j);
 end loop;
 at_:=clock_timestamp();d:=(at_ at time zone 'Asia/Jerusalem')::date;
 update gc_economy.control set writer_tx=txid_current(),batch=batch_,reset_at=at_ where id=1;

 -- Remove financial claims before touching balances. Historical paid records stay.
 update public.loans set status='cancelled',paid_at=at_ where status in('offer','active','late');
 update gx.positions set status='closed',exit=entry,payout=0,reason='economy_reset',closed_at=at_,credited_at=at_ where status<>'closed';
 update public.tourneys set status='cancelled',prize=0,finished_at=at_ where status in('registering','running');
 update public.poker_hands set hand_no=hand_no+1,street='idle',players='{}',board='{}',deck=null,pos=0,to_act=null,deadline=null,current_bet=0,min_raise=0,result=null,next_at=at_;
 delete from public.poker_seats s where not exists(select 1 from public.poker_bots b where b.id=s.user_id);
 -- Bots retain seats and get their ordinary opening stack. No user owns these chips.
 update public.poker_seats s set stack=t.big_blind*100,leaving=false,missed=0,last_seen=at_ from public.poker_tables t where t.id=s.table_id;
 update public.sl_free set left_spins=0,bet=1;
 delete from public.bj_boost;
 update public.sl_jackpots set amount=case kind when 'grand' then 1000000 else 250000 end,
  drop_at=case when kind='mini' then at_+make_interval(secs=>3600+public.rl_randint(14*86400-3600)) else drop_at end,
  deadline=case when kind='mini' then at_+interval '14 days' else deadline end,last_winner=null,last_amount=null,last_at=null;
 update public.job_runs set done=true,paid=0 where not done;
 update public.pm_runs set phase='busted',bank_units=0,paid=0,finished_at=at_ where phase in('playing','checkpoint');
 update public.ck_runs set status='lost',paid=0,finished_at=at_ where status='active';
 update public.f90_runs set status='lost',paid=0,finished_at=at_ where status='active';
 -- settle_round only protects status='settled', so 'void' would allow a late payout.
 update public.game_rounds set status='settled',payout=0,settled_at=at_,state=state||jsonb_build_object('economy_reset',true) where status='open';
 update public.bj_rounds b set status='done',payout=0,finished_at=at_,result=jsonb_build_object('reset',true,'net',-total_staked,'side','{}'::jsonb,
  'hands',(select coalesce(jsonb_agg(jsonb_build_object('outcome','lose','pay',0)),'[]'::jsonb)from jsonb_array_elements(b.hands))) where status<>'done';
 update public.bjt_rounds set phase='done',done_at=0 where phase<>'done';
 update public.dp_hands set status='done',result=jsonb_build_object('reset',true,'pay',0,'net',-(ante+blind+side+play)) where status<>'done';
 update public.dp_rounds set phase='done',done_at=0 where phase<>'done';
 update public.rl_live_bets set settled=true,payout=0 where not settled;
 update public.if_bets set settled=true,payout=0 where not settled;
 update zlm_private.bets set settled=true,payout=0 where not settled;
 update zlm_private.rounds set phase='summary',deadline=at_;
 update zlm_private.control set round_id=null,viewed_at=at_ where id=1;
 -- Cancel only unfinished challenge runs. Preserve completed XP and identities.
 update public.ch_runs set status='done',hands=0,chips=0,points=0,finished_at=at_ where status<>'done';
 update public.ch_duels set status='expired',finished_at=at_ where status not in('done','expired');
 update public.zeus_duels set status='expired',a_chips=0,b_chips=0,finished_at=at_ where status in('invited','active');
 update public.zeus_bets set settled=true,payout=0 where not settled;
 update public.seasons set settled=true,ends_at=least(ends_at,at_),results=coalesce(results,'{}'::jsonb)||jsonb_build_object('economy_reset',true) where not settled;
 insert into public.seasons(no,starts_at,ends_at)select coalesce(max(no),0)+1,at_,at_+interval '14 days' from public.seasons;
 -- Current-period salary and already earned level grants cannot refill old wealth.
 insert into public.salary_claims(user_id,kind,period,amount)
 select p.id,k.kind,case when k.kind='weekly' then d-extract(dow from d)::int else date_trunc('month',d)::date end,0
 from public.profiles p cross join (values('weekly'),('monthly'))k(kind)on conflict do nothing;
 for r in select id from public.profiles order by id loop
  lv:=(public.gc_level_info(r.id)->>'level')::int;
  insert into public.gc_level_seen values(r.id,lv)on conflict(user_id)do update set level=excluded.level;
  if not exists(select 1 from public.wallets where user_id=r.id) then raise exception 'missing_wallet';end if;
  perform public.apply_tx(r.id,'economy','reset',-(select balance from public.wallets where user_id=r.id),'economy-reset:'||batch_||':wallet:'||r.id);
  perform public.bank_add(r.id,'economy_reset',50000000-coalesce((select balance from public.bank_accounts where user_id=r.id),0),'economy-reset:'||batch_||':bank:'||r.id);
 end loop;
 -- Old events, bank flows and fund epochs must not leak into the new indices.
 insert into gx.settlement_days select source,ref,d-1 from gx.settlements on conflict do nothing;
 update gx.control set bank_start_id=(select coalesce(max(id),0)from public.bank_tx),started_at=at_,launch_day=d,last_day=d-1 where id=1;
 insert into gx.funds(user_id,wealth,units,nav,basis,epoch,touched)select id,50000000,500000,100,50000000,at_,at_ from public.profiles
 on conflict(user_id)do update set wealth=excluded.wealth,units=excluded.units,nav=100,basis=excluded.basis,epoch=at_,touched=at_;
 update gx.fund_days set area=0,epoch=at_ where day>=d;
 -- Keep market prices/history: resetting accounts is not a random market movement.
 update gc_economy.control set wallet_cutoff=(select coalesce(max(id),0)from public.wallet_transactions),accounts=(select count(*)from public.profiles),finished_at=at_ where id=1;
 insert into public.house_stats values(1,0,'{}',at_)on conflict(id)do update set total=0,games='{}',at=at_;
 j:=gc_economy.verify();
 if j->>'result'<>'PASS' then raise exception 'reset_verification_failed: %',j;end if;
 update gc_economy.control set verification=j where id=1;
 return j;
end $$;

create or replace function gc_economy.resume()returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare j jsonb;
begin
 if exists(select 1 from gc_economy.control where id=1 and finished_at is not null and not maintenance) then
  return jsonb_build_object('already_resumed',true,'maintenance',false);
 end if;
 j:=gc_economy.verify();if j->>'result'<>'PASS' then raise exception 'reset_not_verified: %',j;end if;
 update gc_economy.control set maintenance=false,writer_tx=null where id=1;
 return j||jsonb_build_object('maintenance',false);
end $$;

create or replace function house_stats() returns jsonb language plpgsql security definer set search_path = public as $$
declare h house_stats; g jsonb; cutoff bigint; reset_at_ timestamptz;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select wallet_cutoff,reset_at into cutoff,reset_at_ from gc_economy.control where id=1;
  select * into h from house_stats where id = 1;
  if found and h.at > now() - interval '5 minutes' then return jsonb_build_object('total', h.total, 'games', h.games, 'at', h.at); end if;
  perform pg_advisory_xact_lock(hashtext('house_stats'));
  select coalesce(jsonb_object_agg(game, net), '{}') into g from (
    select game, -sum(amount) net from wallet_transactions where id>coalesce(cutoff,0) and kind in ('stake', 'payout') group by game
    union all
    select 'poker_bots', -coalesce(sum(w.amount), 0) from wallet_transactions w
      where w.id>coalesce(cutoff,0) and w.game = 'poker' and exists (select 1 from poker_tables t where (t.bots_owner is not null or t.bots_shared is not null) and w.settlement_ref like '%' || t.id::text || '%')
    union all
    select 'bank_loans', coalesce(sum(greatest(0, repaid - principal)), 0) from loans where kind = 'bank' and (reset_at_ is null or created_at>=reset_at_)) x;
  insert into house_stats values (1, (select coalesce(sum(value::text::bigint), 0) from jsonb_each(g)), g, now())
    on conflict (id) do update set total = excluded.total, games = excluded.games, at = excluded.at returning * into h;
  return jsonb_build_object('total', h.total, 'games', h.games, 'at', h.at);
end $$;
revoke all on all functions in schema gc_economy from public,anon,authenticated;
commit;
