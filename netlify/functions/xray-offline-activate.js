// POST /xray/api/offline-activate  (X-ray app: the /xray/activate page on the phone; redirect in netlify.toml)
// Shared implementation: _shared/handlers.js (offlineActivateHandler).
import { offlineActivateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default offlineActivateHandler(PRODUCTS.xray);
