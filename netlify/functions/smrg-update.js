// POST /smrg/api/update  (SMRG app: which update this PC is offered)
// Shared implementation: _shared/handlers.js (updateHandler).
import { updateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default updateHandler(PRODUCTS.smrg);
