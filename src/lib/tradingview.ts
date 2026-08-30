const SCRIPT_IDS = [
  'VLk4jjsn',  // VPCI
  'amTAf5C4',  // RMVE
  'yIuWrDSf',  // OR & Period Levels
  'Cwpxaypy',  // BDRD Full
];

async function pinePerm(action: 'add' | 'remove', scriptId: string, username: string): Promise<boolean> {
  const sessionId = process.env.TV_SESSION_ID;
  const sessionSign = process.env.TV_SESSION_SIGN;
  if (!sessionId) {
    console.error('TV_SESSION_ID not set');
    return false;
  }

  try {
    const cookieParts = [`sessionid=${sessionId}`];
    if (sessionSign) cookieParts.push(`sessionid_sign=${sessionSign}`);

    const res = await fetch(`https://www.tradingview.com/pine_perm/${action}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieParts.join('; '),
        'Origin': 'https://www.tradingview.com',
        'User-Agent': 'Mozilla/5.0',
      },
      body: `pine_id=PUB;${scriptId}&username_recip=${encodeURIComponent(username)}`,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`TV pine_perm/${action} failed for ${scriptId}/${username}: ${res.status} ${text}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`TV pine_perm/${action} error for ${scriptId}/${username}:`, err?.message);
    return false;
  }
}

export async function grantTVAccess(username: string): Promise<{ granted: number; failed: number }> {
  let granted = 0;
  let failed = 0;

  for (const scriptId of SCRIPT_IDS) {
    const ok = await pinePerm('add', scriptId, username);
    if (ok) granted++;
    else failed++;
  }

  console.log(`TV access grant for ${username}: ${granted} granted, ${failed} failed`);
  return { granted, failed };
}

export async function revokeTVAccess(username: string): Promise<{ revoked: number; failed: number }> {
  let revoked = 0;
  let failed = 0;

  for (const scriptId of SCRIPT_IDS) {
    const ok = await pinePerm('remove', scriptId, username);
    if (ok) revoked++;
    else failed++;
  }

  console.log(`TV access revoke for ${username}: ${revoked} revoked, ${failed} failed`);
  return { revoked, failed };
}
