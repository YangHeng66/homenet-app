// 生成 src/lib/connectors/__tests__/ 里用到的对照值。
// 用 Node 自带的 crypto，按 tr3000-dash/www/cgi-bin/dash 的 ufi_sign / f50_auth / 登录口令算法逐步计算，
// 和 src/lib/connectors/hash.ts 的手写实现互相独立。运行：node scripts/ufi-sign-vectors.mjs
import { createHash, createHmac } from 'node:crypto';

const KEY = 'minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd';
const sha = s => createHash('sha256').update(s).digest('hex');
const md5 = s => createHash('md5').update(s).digest('hex');

function sign(method, path, t) {
  const h = createHmac('md5', KEY).update('minikano' + method + path + t).digest();
  const a = createHash('sha256').update(h.subarray(0, 8)).digest();
  const b = createHash('sha256').update(h.subarray(8, 16)).digest();
  return createHash('sha256').update(Buffer.concat([a, b])).digest('hex');
}

console.log(JSON.stringify({
  sign_get_baseDeviceInfo: sign('GET', '/api/baseDeviceInfo', '1731000000000'),
  sign_post_goform_set: sign('POST', '/api/goform/goform_set_cmd_process', '1762761600123'),
  sign_get_goform_get: sign('GET', '/api/goform/goform_get_cmd_process', '1'),
  auth_admin: sha('admin'),
  auth_cn: sha('口令test'),
  zte_ad: sha(sha('WA_INNER_1.0' + 'CR_F50_B15').toUpperCase() + 'rd123').toUpperCase(),
  zte_password: sha(sha('zte-pass').toUpperCase() + 'LD99').toUpperCase(),
  md5_abc: md5('abc'),
  md5_a200: md5('a'.repeat(200)),
  hmac_md5_rfc2202_2: createHmac('md5', 'Jefe').update('what do ya want for nothing?').digest('hex'),
  sha256_cn80: sha('中文'.repeat(40)),
}, null, 2));
