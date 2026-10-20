// POST /displayhub/api/activate  (Display Hub app: online activation; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (activateHandler).
import { activateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default activateHandler(PRODUCTS.displayhub);
