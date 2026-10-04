// Any unknown /smrg/api/... address: a JSON error the SMRG app can read (not the dashboard's HTML page).
// Shared implementation: _shared/handlers.js (notFoundHandler).
import { notFoundHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default notFoundHandler(PRODUCTS.smrg);
