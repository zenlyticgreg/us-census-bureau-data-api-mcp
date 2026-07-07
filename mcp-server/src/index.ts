const transportMode = process.env.TRANSPORT === 'http' ? 'http' : 'stdio'
const enableDebugLogs = process.env.DEBUG_LOGS === 'true'

// stdio reserves stdout for protocol frames, so console.log/info/warn are
// silenced there unless debugging. The http transport doesn't share stdout
// with the protocol, so it keeps normal logging.
if (transportMode === 'stdio' && !enableDebugLogs) {
  console.log = () => {}
  console.info = () => {}
  console.warn = () => {}
}

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './build-server.js'
import { runHttp } from './http-server.js'

// MCP Server Setup — stdio (default, matches upstream) for local clients
// like Claude Desktop/Code; TRANSPORT=http for a remote connector (see
// http-server.ts for why upstream's stdio-only setup can't serve that role).
async function runStdio() {
  const mcpServer = buildServer()
  const transport = new StdioServerTransport()
  await mcpServer.connect(transport)
}

if (transportMode === 'http') {
  runHttp().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
} else {
  runStdio().catch(console.error)
}
