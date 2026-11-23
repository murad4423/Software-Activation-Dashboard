// GET /visionchart/api/update/download  (SmartMed Vision Chart TV app; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (updateDownloadHandler).
import { updateDownloadHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default updateDownloadHandler(PRODUCTS.visionchart);
