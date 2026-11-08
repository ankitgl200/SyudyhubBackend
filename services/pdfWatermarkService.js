const fs = require('fs');
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');

/**
 * StudyMyte PDF Watermarking Engine
 * Applies a non-intrusive, professional watermark to educational PDFs:
 * 1. Ultra-subtle diagonal center branding (7-8% opacity) that never obscures
 *    formulas, source code, diagrams, or handwritten text.
 * 2. Elegant, micro-running bottom footer (attributing StudyMyte as the verified source).
 *
 * @param {string|Buffer} input - File path on disk or Buffer containing PDF data
 * @returns {Promise<{success: boolean, buffer: Buffer, pagesWatermarked: number, error?: string}>}
 */
async function applyStudyMyteWatermark(input) {
  try {
    let pdfBytes;
    let filePath = null;

    if (typeof input === 'string') {
      filePath = input;
      pdfBytes = await fs.promises.readFile(input);
    } else if (Buffer.isBuffer(input)) {
      pdfBytes = input;
    } else {
      throw new Error('Invalid input: expected file path string or Buffer');
    }

    // Load PDF document (ignore encryption for user-viewable files)
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;

    if (totalPages === 0) {
      return { success: true, buffer: pdfBytes, pagesWatermarked: 0 };
    }

    // Embed standard fonts (HelveticaBold for logo text, Helvetica for subtitle/footer)
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Subtle Brand Palette (StudyMyte Indigo Slate)
    const watermarkColor = rgb(0.20, 0.35, 0.60); // #335999
    const footerColor = rgb(0.40, 0.48, 0.58);    // #667a94
    const diagonalOpacity = 0.075;                // 7.5% - perfectly readable academic text
    const footerOpacity = 0.45;                    // Clean, subtle publisher running footer

    for (let i = 0; i < totalPages; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();

      // Skip abnormally small or zero-dimension pages
      if (width < 50 || height < 50) continue;

      // -------------------------------------------------------------
      // 1. Diagonal Center Watermark (Non-obstructive)
      // -------------------------------------------------------------
      const minDim = Math.min(width, height);
      const titleSize = Math.max(28, Math.min(56, minDim * 0.085));
      const subSize = titleSize * 0.32;

      const titleText = 'StudyMyte';
      const subText = 'VERIFIED ACADEMIC RESOURCE';

      const titleWidth = helveticaBold.widthOfTextAtSize(titleText, titleSize);
      const titleHeight = helveticaBold.heightAtSize(titleSize);
      const subWidth = helvetica.widthOfTextAtSize(subText, subSize);

      // Angle: 45 degrees
      const angle = 45;
      const angleRad = (angle * Math.PI) / 180;
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);

      // Center calculation: offsets calculated so center of text block sits at page center
      const centerX = width / 2;
      const centerY = height / 2;

      // Title position
      const titleOffsetX = -titleWidth / 2;
      const titleOffsetY = titleHeight * 0.2;
      const titleX = centerX + (titleOffsetX * cosA - titleOffsetY * sinA);
      const titleY = centerY + (titleOffsetX * sinA + titleOffsetY * cosA);

      page.drawText(titleText, {
        x: titleX,
        y: titleY,
        size: titleSize,
        font: helveticaBold,
        color: watermarkColor,
        opacity: diagonalOpacity,
        rotate: degrees(angle)
      });

      // Subtitle position (placed slightly below title along the perpendicular)
      const subOffsetY = -titleHeight * 0.9;
      const subOffsetX = -subWidth / 2;
      const subX = centerX + (subOffsetX * cosA - subOffsetY * sinA);
      const subY = centerY + (subOffsetX * sinA + subOffsetY * cosA);

      page.drawText(subText, {
        x: subX,
        y: subY,
        size: subSize,
        font: helvetica,
        color: watermarkColor,
        opacity: diagonalOpacity * 0.95,
        rotate: degrees(angle)
      });

      // -------------------------------------------------------------
      // 2. Micro Running Footer (Publisher attribution)
      // -------------------------------------------------------------
      const footerFontSize = Math.max(7, Math.min(9, width * 0.015));
      const footerText = 'StudyMyte • Verified Student Learning Resource • www.studymyte.tech';
      const footerWidth = helvetica.widthOfTextAtSize(footerText, footerFontSize);
      const footerX = Math.max(15, (width - footerWidth) / 2);
      const footerY = Math.max(8, height * 0.018);

      page.drawText(footerText, {
        x: footerX,
        y: footerY,
        size: footerFontSize,
        font: helvetica,
        color: footerColor,
        opacity: footerOpacity
      });
    }

    const modifiedBytes = await pdfDoc.save();
    const resultBuffer = Buffer.from(modifiedBytes);

    // If input was a file on disk, overwrite it with the watermarked version
    if (filePath) {
      await fs.promises.writeFile(filePath, resultBuffer);
    }

    return {
      success: true,
      buffer: resultBuffer,
      pagesWatermarked: totalPages
    };
  } catch (err) {
    console.warn('[PDFWatermarkService] Notice: could not apply watermark:', err.message);
    // Non-fatal fallback: return original input
    let fallbackBuffer;
    if (typeof input === 'string') {
      try { fallbackBuffer = await fs.promises.readFile(input); } catch (_) { fallbackBuffer = null; }
    } else {
      fallbackBuffer = input;
    }
    return {
      success: false,
      buffer: fallbackBuffer,
      pagesWatermarked: 0,
      error: err.message
    };
  }
}

module.exports = {
  applyStudyMyteWatermark
};
