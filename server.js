const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const { seed } = require('./db/seed');
seed();

const authRoutes = require('./src/routes/auth');
const hotelRoutes = require('./src/routes/hotels');
const inspectorRoutes = require('./src/routes/inspectors');
const assignmentRoutes = require('./src/routes/assignments');
const inspectionRoutes = require('./src/routes/inspections');
const standardsRoutes = require('./src/routes/standards');
const metaRoutes = require('./src/routes/meta');

const app = express();
app.use(express.json({ limit: '5mb' })); // signatures are base64 PNGs
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.use('/api/auth', authRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/inspectors', inspectorRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/standards', standardsRoutes);
app.use('/api/meta', metaRoutes);

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`THO Mystery Guest platform running on port ${PORT}`);
});
