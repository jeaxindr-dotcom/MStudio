import path from 'node:path';
import crypto from 'node:crypto';

// Episode IDs are only unique inside one theatre. Use the review directory so
// separate E19 projects never reuse each other's frames, even when their source
// files have identical timestamps. This also survives import into the library.
export function reviewFrameCache(root, review, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const absolute = paths.resolve(review);
  const identity = platform === 'win32' ? absolute.toLowerCase() : absolute;
  const key = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return path.join(root, 'frames', key);
}
