/* The member's own caricature (assigned by the admin), from the private "characters" bucket. */
window.GC_CHAR = async function (db, uid) {
  try {
    const { data: p } = await db.from("profiles").select("nickname,character_key").eq("id", uid).single();
    if (!p) return {};
    if (!p.character_key) return { nick: p.nickname };
    const { data } = await db.storage.from("characters").createSignedUrl(p.character_key + ".webp", 3600);
    return { nick: p.nickname, url: data && data.signedUrl };
  } catch (e) { return {}; }
};
