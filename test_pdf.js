const PDFDocument = require('pdfkit');

const doc = new PDFDocument({ margin: 50, size: 'A4' });
const pageWidth = doc.page.width - 100;
const footerY = doc.page.height - 90;

doc.font('Helvetica').fontSize(9);
const pWidth = doc.widthOfString('Powered by ');

doc.font('Helvetica-Bold').fontSize(9);
const bWidth = doc.widthOfString('Be3');

const totalW = pWidth + bWidth;
const startX = 50 + (pageWidth - totalW) / 2;

console.log({ pWidth, bWidth, totalW, startX, footerY });

// Try explicitly setting the bounding box for link, or removing lineBreak
doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
   .text('Powered by ', startX, footerY, { continued: true })
   .font('Helvetica-Bold').fontSize(9).fillColor('#1a56e8')
   .text('Be3', { link: 'https://be3.shop' });

doc.end();
