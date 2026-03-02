const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  console.log('New contact submission:', { name, email, message });

  res.json({ success: true, message: 'Thanks for reaching out! We\'ll be in touch.' });
});

app.get('/api/listings/:slug', (req, res) => {
  const { slug } = req.params;

  if (slug.includes('..') || slug.includes('/')) {
    return res.status(400).json({ error: 'Invalid listing slug.' });
  }

  const filePath = path.join(__dirname, 'data', `${slug}.json`);

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Listing not found.' });
      }
      return res.status(500).json({ error: 'Failed to load listings.' });
    }

    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: 'Invalid listing data.' });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
