const fs = require('node:fs');
for (const protocol of ['node:http', 'node:https']) {
  const client = require(protocol);
  const original = client.request;
  client.request = function (target, ...rest) {
    const host = typeof target === 'string' ? new URL(target).hostname : target.hostname || target.host;
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
      fs.appendFileSync(process.env.OPENPLAN_FONT_NETWORK_LOG, `${host}\n`);
      throw new Error('Font network access disabled for verification');
    }
    return original.call(this, target, ...rest);
  };
}
