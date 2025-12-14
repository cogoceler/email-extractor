const express = require('express');
const cors = require('cors');
const { extractEmails, extractEmailsSimple } = require('./extractor.js');
const path = require('path');
const dotenv = require('dotenv');
const os = require('os');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting configuration
const requestCounts = new Map();
const RATE_LIMIT = process.env.RATE_LIMIT_POINTS || 50;
const RATE_LIMIT_WINDOW = (process.env.RATE_LIMIT_DURATION || 60) * 1000;

// Enhanced CORS for production
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? ['https://email-extractor-saas.onrender.com', 'https://your-custom-domain.com']
  : ['http://localhost:3000', 'http://localhost:5500'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Handle preflight
app.options('*', cors());

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${req.ip}`);
  next();
});

// Rate limiting middleware
app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, startTime: now });
  } else {
    const userData = requestCounts.get(ip);
    
    if (now - userData.startTime > RATE_LIMIT_WINDOW) {
      userData.count = 1;
      userData.startTime = now;
    } else {
      userData.count++;
      
      if (userData.count > RATE_LIMIT) {
        const resetTime = Math.ceil((userData.startTime + RATE_LIMIT_WINDOW - now) / 1000);
        return res.status(429).json({
          success: false,
          error: `Rate limit exceeded. Please try again in ${resetTime} seconds.`,
          retryAfter: resetTime
        });
      }
    }
  }
  
  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT - requestCounts.get(ip).count);
  res.setHeader('X-RateLimit-Reset', Math.ceil((requestCounts.get(ip).startTime + RATE_LIMIT_WINDOW) / 1000));
  
  next();
});

// Clean up old rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of requestCounts.entries()) {
    if (now - data.startTime > RATE_LIMIT_WINDOW * 2) {
      requestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for email extraction
app.post('/api/extract', async (req, res) => {
  try {
    const { url, method = 'playwright' } = req.body;
    
    console.log(`📥 Received extraction request for: ${url}`);
    
    // Validate URL
    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL is required' 
      });
    }
    
    // Add https:// if missing
    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      targetUrl = 'https://' + url;
    }
    
    if (!isValidUrl(targetUrl)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid URL format' 
      });
    }
    
    // Block certain domains for security
    const blockedDomains = [
      'localhost',
      '127.0.0.1',
      '192.168.',
      '10.',
      '172.16.',
      'internal',
      'local'
    ];
    
    if (blockedDomains.some(domain => targetUrl.includes(domain))) {
      return res.status(400).json({ 
        success: false, 
        error: 'Internal domains are not allowed' 
      });
    }
    
    const startTime = Date.now();
    let emails;
    
    // Use simple extraction on free tier (more reliable)
    emails = await extractEmailsSimple(targetUrl);
    
    const endTime = Date.now();
    const timeTaken = endTime - startTime;
    
    console.log(`✅ Extracted ${emails.length} emails in ${timeTaken}ms`);
    
    res.json({
      success: true,
      url: targetUrl,
      count: emails.length,
      emails: emails,
      timeTaken: timeTaken,
      method: 'simple',
      timestamp: new Date().toISOString(),
      note: 'Using simple extraction method on free tier'
    });
    
  } catch (error) {
    console.error('❌ Extraction error:', error.message);
    
    let errorMessage = 'Failed to extract emails';
    let statusCode = 500;
    
    if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      errorMessage = 'Website not found. Please check the URL.';
      statusCode = 404;
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'Cannot connect to the website. It might be blocking requests.';
      statusCode = 400;
    } else if (error.message.includes('timeout')) {
      errorMessage = 'The website took too long to respond.';
      statusCode = 408;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
});

// Simple extraction endpoint
app.post('/api/extract-simple', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL is required' 
      });
    }
    
    // Add https:// if missing
    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      targetUrl = 'https://' + url;
    }
    
    const emails = await extractEmailsSimple(targetUrl);
    
    res.json({
      success: true,
      url: targetUrl,
      count: emails.length,
      emails: emails,
      method: 'simple',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Simple extraction error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'Email Extractor API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// System info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    service: 'Email Extractor SaaS',
    version: '1.0.0',
    nodeVersion: process.version,
    platform: process.platform,
    memory: process.memoryUsage(),
    rateLimit: {
      points: RATE_LIMIT,
      duration: RATE_LIMIT_WINDOW / 1000 + ' seconds'
    }
  });
});

// 404 handler for API
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'API endpoint not found' 
  });
});

// Serve static files for any other route
app.use('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function to validate URL
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`
  🚀 Email Extractor SaaS Started!
  ==================================
  📍 Port: ${PORT}
  📍 Environment: ${process.env.NODE_ENV || 'development'}
  
  📊 API Endpoints:
  - GET  /                 → Frontend UI
  - POST /api/extract      → Extract emails
  - POST /api/extract-simple → Simple extraction
  - GET  /api/health       → Health check
  
  🔒 Rate Limiting: ${RATE_LIMIT} requests per ${RATE_LIMIT_WINDOW / 1000} seconds
  
  💡 Running on Render Free Tier
  ==================================
  `);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});