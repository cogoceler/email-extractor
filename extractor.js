const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Main extraction function using Simple HTTP
async function extractEmails(url) {
  try {
    console.log(`📡 Starting extraction for: ${url}`);
    return await extractEmailsSimple(url);
  } catch (error) {
    console.error('❌ Extraction failed:', error.message);
    throw error;
  }
}

// Simple extraction using Node.js HTTP/HTTPS
async function extractEmailsSimple(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'no-cache'
      },
      timeout: 10000 // 10 second timeout
    };
    
    const req = protocol.request(options, (res) => {
      // Check if response is OK
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      
      // Collect data
      let data = '';
      res.setEncoding('utf8');
      
      res.on('data', (chunk) => {
        data += chunk;
        // Limit response size to prevent memory issues
        if (data.length > 10 * 1024 * 1024) { // 10MB limit
          req.destroy();
          reject(new Error('Response too large'));
        }
      });
      
      res.on('end', () => {
        try {
          const emails = extractEmailsFromHTML(data);
          resolve(emails);
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

// Helper function to extract emails from HTML content
function extractEmailsFromHTML(html) {
  try {
    const $ = cheerio.load(html);
    
    // Get all text content
    const text = $('body').text();
    
    // Also check for mailto links
    const mailtoLinks = [];
    $('a[href^="mailto:"]').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        const email = href.replace('mailto:', '').split('?')[0].trim();
        if (email && isValidEmail(email)) {
          mailtoLinks.push(email);
        }
      }
    });
    
    // Enhanced email regex pattern
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/g;
    
    // Find all email matches in text
    const textMatches = (text.match(emailRegex) || [])
      .filter(email => isValidEmail(email));
    
    // Combine and deduplicate
    const allEmails = [...new Set([...textMatches, ...mailtoLinks])];
    
    // Filter out common false positives
    const filteredEmails = allEmails.filter(email => {
      const lowerEmail = email.toLowerCase();
      
      // Common false positives to exclude
      const falsePositives = [
        'example.com',
        'example.org',
        'domain.com',
        'email.com',
        'test.com',
        'yourdomain.com',
        'yoursite.com',
        'sentry.io',
        'wixpress.com',
        'example@example',
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.svg',
        '.css',
        '.js',
        '.webp',
        'email@email',
        'your@email',
        'you@example'
      ];
      
      return !falsePositives.some(fp => lowerEmail.includes(fp)) &&
             email.length >= 6 &&
             email.includes('@') &&
             email.split('@')[1].includes('.') &&
             !email.endsWith('.png') &&
             !email.endsWith('.jpg') &&
             !email.endsWith('.jpeg') &&
             !email.endsWith('.gif') &&
             !email.endsWith('.svg');
    });
    
    // Sort emails alphabetically
    filteredEmails.sort((a, b) => a.localeCompare(b));
    
    return filteredEmails;
    
  } catch (error) {
    console.error('Error parsing HTML:', error.message);
    return [];
  }
}

// Helper function to validate email format
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?$/;
  return emailRegex.test(email);
}

// Export functions
module.exports = {
  extractEmails,
  extractEmailsSimple,
  extractEmailsFromHTML,
  isValidEmail
};