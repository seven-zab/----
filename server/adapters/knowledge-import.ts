import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { ensure } from '../core/errors';
import { officialSource } from '../modules/policy/service';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
export interface KnowledgeImporter {
  read(source: string): Promise<string>;
}
/** Only official UTF-8 plain text, no redirects, pinned public DNS result, bounded response. */
export const officialTextImporter: KnowledgeImporter = {
  async read(source) {
    const url = new URL(officialSource(source));
    ensure(
      !url.port || url.port === '443',
      'VALIDATION_FAILED',
      '知识导入只支持标准 HTTPS 端口',
      400,
    );
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    ensure(
      addresses.length > 0 &&
        addresses.every(
          (a) => isIP(a.address) && !blocked.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'),
        ),
      'FORBIDDEN',
      '知识来源必须使用公开地址',
    );
    const address = addresses[0];
    return new Promise<string>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          headers: { Accept: 'text/plain' },
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        },
        (res) => {
          if (
            res.statusCode !== 200 ||
            !/^text\/plain(?:;|$)/i.test(String(res.headers['content-type']))
          ) {
            res.resume();
            reject(new Error('知识来源须为可公开读取的 UTF-8 纯文本，且不能跳转'));
            return;
          }
          const buffers: Buffer[] = [];
          let size = 0;
          res.on('data', (part: Buffer) => {
            size += part.length;
            if (size > 100000) res.destroy(new Error('知识来源超过100KB'));
            else buffers.push(part);
          });
          res.on('error', reject);
          res.on('end', () => {
            try {
              const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers));
              ensure(
                Array.from(body).length <= 20000,
                'VALIDATION_FAILED',
                '知识正文超过20000字',
                400,
              );
              resolve(body);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.setTimeout(10000, () => req.destroy(new Error('知识来源读取超时')));
      req.on('error', reject);
      req.end();
    });
  },
};
