// POST /smrg/api/offline-activate  (public; called by the /smrg/activate page a phone opens from the app's QR code)
// Shared implementation: _shared/handlers.js (offlineActivateHandler).
import { offlineActivateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default offlineActivateHandler(PRODUCTS.smrg);
