// Simple Express wrapper to run the serverless handlers locally for development
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const presignUpload = require('./api/presign-upload');
const presignDownload = require('./api/presign-download');
const list = require('./api/list');
const del = require('./api/delete');
const health = require('./api/health');

const app = express();
app.use(bodyParser.json());

app.post('/api/presign-upload', presignUpload);
app.post('/api/presign-download', presignDownload);
app.get('/api/list', list);
app.post('/api/delete', del);
app.get('/api/health', health);

const port = process.env.PORT || 4001;
app.listen(port, () => console.log('Dev API listening on http://localhost:' + port));
