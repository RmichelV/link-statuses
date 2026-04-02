// Must be set BEFORE any module imports that create HTTPS connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import('./server');
