import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer } from './build-server.js'
import { DatabaseService } from './services/database.service.js'

// Added on top of upstream to make this server reachable as a remote MCP
// connector (e.g. Zenlytic's MCP Connectors), which requires a publicly
// reachable HTTPS endpoint speaking the streamable HTTP transport. Upstream
// only ships stdio, which a remote client cannot reach over the network.
export async function runHttp(): Promise<void> {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  app.get('/healthz', (_req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const healthy = await DatabaseService.getInstance().healthCheck()
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        service: 'us-census-bureau-data-api-mcp',
      })
    })()
  })

  const authToken = process.env.MCP_AUTH_TOKEN
  if (authToken) {
    app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
      if (req.headers.authorization !== `Bearer ${authToken}`) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized' },
          id: null,
        })
        return
      }
      next()
    })
  } else {
    console.error(
      'MCP_AUTH_TOKEN is not set — /mcp is unauthenticated. Set it before exposing this server publicly.',
    )
  }

  // Stateless streamable HTTP: fresh server + transport per request, so
  // concurrent clients never share protocol state or request IDs.
  app.post('/mcp', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const mcpServer = buildServer()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      res.on('close', () => {
        void transport.close()
      })
      try {
        await mcpServer.connect(transport)
        await transport.handleRequest(req, res, req.body)
      } catch (error) {
        console.error('MCP request handling failed:', error)
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          })
        }
      }
    })()
  })

  // Stateless mode: session-oriented GET/DELETE are not supported.
  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode' },
      id: null,
    })
  })

  const port = parseInt(process.env.PORT ?? '3000', 10)
  app.listen(port, () => {
    console.error(
      `MCP server ready on streamable HTTP at :${port}/mcp (health at /healthz)`,
    )
  })
}
