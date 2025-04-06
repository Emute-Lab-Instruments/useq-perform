import { readFileSync, writeFileSync } from 'fs';
import { marked } from 'marked';
import path from 'path';

function convertMarkdownToHtml() {
  console.log('Converting userGuide.md to HTML...');
  
  // Read markdown file
  const markdownPath = path.resolve('./content/userGuide.md');
  const markdown = readFileSync(markdownPath, 'utf-8');
  
  // Convert to HTML
  const html = marked.parse(markdown);
  
  // Add some minimal styling and the required script that handles the tabs
  const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: var(--text-primary, #333);
      max-width: 100%;
      padding: 0 15px;
      margin: 0;
    }
    code {
      font-family: Consolas, Monaco, 'Andale Mono', monospace;
      background-color: var(--panel-control-bg, #f4f4f4);
      padding: 2px 4px;
      border-radius: 3px;
    }
    pre {
      background-color: var(--panel-control-bg, #f4f4f4);
      padding: 12px;
      border-radius: 4px;
      overflow: auto;
    }
    .experience-selector {
      background: var(--panel-section-bg, #f5f5f5);
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
      text-align: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .experience-selector button {
      background: var(--panel-control-bg, #e0e0e0);
      border: none;
      padding: 8px 16px;
      margin: 0 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.3s ease;
    }
    .experience-selector button.active {
      background: var(--accent-color, #007bff);
      color: white;
    }
    #advanced-content, #advanced-content-continued {
      border-top: 1px solid var(--panel-border, #eee);
      margin-top: 20px;
      padding-top: 20px;
    }
    h2 {
      position: sticky;
      top: 70px;
      background-color: var(--panel-bg, rgba(255,255,255,0.95));
      margin: 0 -15px;
      padding: 10px 15px;
      z-index: 90;
      border-bottom: 1px solid var(--panel-border, rgba(0,0,0,0.1));
    }
    h3 {
      position: sticky;
      top: 120px;
      background-color: var(--panel-bg, rgba(255,255,255,0.95));
      margin: 0 -15px;
      padding: 8px 15px;
      z-index: 80;
      border-bottom: 1px solid var(--panel-border, rgba(0,0,0,0.1));
    }
    .back-to-top {
      position: sticky;
      bottom: 20px;
      text-align: center;
      z-index: 100;
      margin: 20px auto;
      width: 180px;
    }
    .back-to-top a {
      display: inline-block;
      padding: 8px 16px;
      background-color: var(--accent-color, #007bff);
      color: white;
      text-decoration: none;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      font-size: 14px;
      transition: all 0.3s ease;
    }
    .back-to-top a:hover {
      background-color: var(--accent-color-hover, #0069d9);
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    }
    a {
      color: var(--accent-color, #007bff);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  ${html}
  
  <div class="back-to-top">
    <a href="#useq-user-guide">↑ Back to Top</a>
  </div>

  <script>
  document.addEventListener('DOMContentLoaded', function() {
    // Get reference to buttons and content divs
    const beginnerBtn = document.getElementById('beginner-button');
    const advancedBtn = document.getElementById('advanced-button');
    const beginnerContent = document.getElementById('beginner-content');
    const advancedContent = document.getElementById('advanced-content');
    const advancedContentContinued = document.getElementById('advanced-content-continued');
    
    // Add click event listeners
    if (beginnerBtn && advancedBtn) {
      beginnerBtn.addEventListener('click', function() {
        beginnerContent.style.display = 'block';
        advancedContent.style.display = 'none';
        if (advancedContentContinued) {
          advancedContentContinued.style.display = 'none';
        }
        beginnerBtn.classList.add('active');
        advancedBtn.classList.remove('active');
        localStorage.setItem('useqExperienceLevel', 'beginner');
      });
      
      advancedBtn.addEventListener('click', function() {
        beginnerContent.style.display = 'none';
        advancedContent.style.display = 'block';
        if (advancedContentContinued) {
          advancedContentContinued.style.display = 'block';
        }
        beginnerBtn.classList.remove('active');
        advancedBtn.classList.add('active');
        localStorage.setItem('useqExperienceLevel', 'advanced');
      });

      // Check if user has a preference stored
      const savedExperience = localStorage.getItem('useqExperienceLevel');
      if (savedExperience === 'advanced') {
        advancedBtn.click();
      } else {
        beginnerBtn.click();
      }
    }
    
    // Add smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        document.querySelector(this.getAttribute('href')).scrollIntoView({
          behavior: 'smooth'
        });
      });
    });
  });
  </script>
</body>
</html>
  `;
  
  // Write to HTML file
  const htmlPath = path.resolve('./public/userguide.html');
  writeFileSync(htmlPath, fullHtml);
  
  console.log('Conversion complete. HTML file saved to', htmlPath);
}

// Run the conversion
convertMarkdownToHtml();

// If this script is run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  convertMarkdownToHtml();
}

// Export for use in other scripts
export { convertMarkdownToHtml };