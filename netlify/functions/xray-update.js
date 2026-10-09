// POST /xray/api/update  (X-ray app: is there a newer version?; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (updateHandler).
import { updateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default updateHandler(PRODUCTS.xray);
