// POST /.netlify/functions/displayhubtv-admin  (dashboard only — requires the admin login)
// Shared implementation: _shared/handlers.js (adminHandler). Only the updates and TV-record actions are allowed
// for this product; every licence action is refused, because the TV app has no licence.
import { adminHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default adminHandler(PRODUCTS.displayhubtv);
