// Fictional server responses for the targeted native-write authority requests.
// Mutation, concurrency and malformed/denied-response tests supply their own.
export function nativePermissionResponse(url, options = {}) {
  if (options.method === 'PROPFIND' && options.headers?.Depth === '0' && options.body?.includes('<d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/>')) {
    return new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${url}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, {status: 207});
  }
  if ((!options.method || options.method === 'GET') && options.headers?.['Cache-Control'] === 'no-cache') {
    const board = /\/boards\/(\d+)$/.exec(url);
    if (board) return new Response(JSON.stringify({id: Number(board[1]), archived: false, deletedAt: 0, permissions: {PERMISSION_EDIT: true}}));
    const stack = /\/boards\/(\d+)\/stacks\/(\d+)$/.exec(url);
    if (stack) return new Response(JSON.stringify({id: Number(stack[2]), boardId: Number(stack[1]), deletedAt: 0}));
  }
  return null;
}
