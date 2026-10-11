'use strict';
const crypto = require('node:crypto');
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/; // CONTRACT section 2, rule 1
const newId = () => crypto.randomUUID();
module.exports = { ID_RE, newId };
