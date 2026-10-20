// POST /displayhub/api/dev-reset-request  (Display Hub app: ask the developer to free this PC; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (devResetRequestHandler).
import { devResetRequestHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default devResetRequestHandler(PRODUCTS.displayhub);
