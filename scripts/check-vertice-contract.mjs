import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const reader=fs.readFileSync('reader-comments.js','utf8');
const author=fs.readFileSync('author.html','utf8');

const required=[
 ['Kodes identity in navigation',/id="kodes-reader-status"/],
 ['Inline discussion section',/kodes-article-identity/],
 ['Focused article reading',/kodes-article-reading-mode/],
 ['Publisher article identifiers',/data-article-slug/],
 ['Real author profile contract',/identity_type!=='publisher_editorial_directory'/]
];
for(const [name,pattern] of required){
 const source=name.includes('author')?author:html;
 assert.match(source,pattern,name);
}

for(const [name,pattern] of [
 ['Real Kodes N2 grant',/kodes-comment-grant/],
 ['Verified credential badge',/kodes_comment_signatures\(level,verified_at\)/],
 ['Comment reply nesting',/parent_id/],
 ['Approved ticket refreshes persistent identity before returning to comment',/await refreshKodesIdentity\(authRevision\);\s*if\(authRevision!==revision\)return;\s*repaintGrants\(\);[\s\S]*?p\.input\.focus\(\)/],
 ['Entry click renews only verified linked identity',/gateButton\.onclick=\(\)=>\{[\s\S]*?kodesIdentity\?\.linked&&kodesIdentity\.canComment[\s\S]*?refreshLinkedKodesGrant\(\)/],
 ['Unlinked reader still enters consent modal',/else kodesIdentityDialog\(false\)/],
 ['Renewal is server-verified',/body:\{action:'refresh_linked'\}/],
 ['No level without server proof',/if\(stamped&&Number\.isInteger\(stamped\.level\)/],
 ['Moderation choice from server',/kodes_comment_moderation_settings/],
 ['Public profile only with opt-in',/consentedCard\(userId\)/],
]){
 assert.match(reader,pattern,name);
}

const ticketHandler=reader.slice(reader.indexOf("window.addEventListener('message',async event=>"),reader.indexOf("let likesReady"));
assert.ok(ticketHandler.includes("event.source!==kodesPopup"),'Ticket must originate from the expected popup');
assert.ok(ticketHandler.includes("event.data?.state!==kodesState"),'Ticket must match the original request');
assert.ok(!ticketHandler.includes('kodesIdentityDialog(true)'),'Successful authorization must not reopen onboarding');

// Parse all inline JavaScript, excluding scripts with src.
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/\bsrc\s*=/.test(match[1]))continue;
 new vm.Script(match[2],{filename:'index.html inline script'});
}
for(const file of ['reader-comments.js','admin.js','kodes-managed-admin.js']){
 new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
}
assert.ok(!html.includes('id="kodes-identity-guide"'),'Old promotional identity block must not return');
console.log('Vértice integration surface regression checks passed');

const pilot=reader.slice(reader.indexOf('// The new journey requests'),reader.indexOf("  window.addEventListener('message',async event=>{\n    if(vorticePilot||"));
for(const pattern of ['event.origin!==KODES_ORIGIN','event.source!==kodesPopup','event.data?.state!==kodesState','vorticeReaderRevision!==revision','session.user.id!==user.id','await refreshKodesIdentity(v)','acknowledge(true)'])assert.ok(pilot.includes(pattern),'Missing Vortice pilot guard: '+pattern);
assert.ok(pilot.indexOf('await refreshKodesIdentity(v)')<pilot.indexOf('acknowledge(true)'),'Identity must refresh before acknowledgement');
assert.ok(!reader.includes('publicCards.get'),'Do not reuse potentially revoked public profile consent');
assert.ok(reader.includes('kodesIdentity.credentialId'),'Actual credential should be visible to current owner');
console.log('Vórtice pilot message and identity contract checks passed');
