// Netlify Functions entry. Wraps the Express app via serverless-http so
// every route / middleware works exactly as on Node, without manually
// shimming Lambda's event/context shape.
//
// Routing is driven by netlify.toml [[redirects]] — every non-static
// path is rewritten to /.netlify/functions/api/* and lands here.
const serverless = require('serverless-http')
const app = require('../../src/server.js')

module.exports.handler = serverless(app)
