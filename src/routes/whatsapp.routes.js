const express = require('express');
const controller = require('../controllers/whatsapp.controller');

const router = express.Router();

router.post('/whatsapp', controller.handleIncoming);

module.exports = router;
