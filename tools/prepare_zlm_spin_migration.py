from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
source=(root/'supabase/migrations/0097_zman_lamatvach.sql').read_text(encoding='utf-8')
match=re.search(r'create or replace function zlm_private\.tick\(wake boolean default false\).*?end \$\$;',source,re.S)
assert match
body=match.group()
assert body.count("interval '6 seconds'")==1
body=body.replace("interval '6 seconds'","interval '9 seconds'")
target=root/'supabase/migrations/0099_zman_spin_duration.sql'
assert not target.exists()
target.write_text("-- Extend the shared spin phase; preserve the existing state machine.\n"+body+"\nrevoke all on function zlm_private.tick(boolean) from public,anon,authenticated;\nselect case when pg_get_functiondef('zlm_private.tick(boolean)'::regprocedure) like '%9 seconds%' then 'PASS: shared spin is 9 seconds' else 'FAIL' end as validation;\n",encoding='utf-8')
