// POST /smrg/api/dev-reset-request  (SMRG app: hidden developer reset, only RECORDS the request)
// Shared implementation: _shared/handlers.js (devResetRequestHandler).
import { devResetRequestHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default devResetRequestHandler(PRODUCTS.smrg);
