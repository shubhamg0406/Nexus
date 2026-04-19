import { queryParam, type RequestLike, type ResponseLike } from './_shared.js';

export default async function handler(req: RequestLike, res: ResponseLike) {
  const result = queryParam(req, 'result') || 'error';
  const reason = queryParam(req, 'reason') || '';
  const payloadType =
    result === 'success'
      ? 'SPLITWISE_CONNECTED'
      : result === 'cancelled'
        ? 'SPLITWISE_CANCELLED'
        : 'SPLITWISE_ERROR';
  const payload = JSON.stringify({ type: payloadType, reason });

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html>
  <body>
    <script>
      (function () {
        var payload = ${payload};
        try {
          localStorage.setItem('splitwise_oauth_result', JSON.stringify({
            type: payload.type,
            reason: payload.reason || '',
            at: Date.now()
          }));
        } catch (_) {}
        try {
          if (window.opener) {
            window.opener.postMessage(payload, '*');
          }
        } catch (_) {}
        window.close();
      })();
    </script>
  </body>
</html>`);
}
