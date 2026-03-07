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

app.get('/api/history/:slug', (req, res) => {
  const { slug } = req.params;

  if (slug.includes('..') || slug.includes('/')) {
    return res.status(400).json({ error: 'Invalid slug.' });
  }

  const filePath = path.join(__dirname, 'data', 'history', `${slug}.json`);

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.json({ trend: [], distribution: null });
      }
      return res.status(500).json({ error: 'Failed to load history.' });
    }

    try {
      const history = JSON.parse(data);

      // Compute aggregate stats per day (per-listing data reserved for premium)
      const trend = history.map(snapshot => {
        const prices = snapshot.listings.map(l => l.price).sort((a, b) => a - b);
        const count = prices.length;

        if (count === 0) {
          return { date: snapshot.date, count: 0, median: null, mean: null, min: null, max: null };
        }

        const sum = prices.reduce((a, b) => a + b, 0);
        const mean = Math.round(sum / count);
        const median = count % 2 === 0
          ? Math.round((prices[count / 2 - 1] + prices[count / 2]) / 2)
          : prices[Math.floor(count / 2)];

        return { date: snapshot.date, count, median, mean, min: prices[0], max: prices[count - 1] };
      });

      // Latest snapshot distribution (just sorted prices, no listing details)
      const latestSnapshot = history[history.length - 1];
      const distribution = (latestSnapshot && latestSnapshot.listings.length > 0)
        ? latestSnapshot.listings.map(l => l.price).sort((a, b) => a - b)
        : null;

      res.json({ trend, distribution });
    } catch {
      res.status(500).json({ error: 'Invalid history data.' });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
