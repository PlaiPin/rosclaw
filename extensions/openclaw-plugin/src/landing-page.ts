/**
 * Returns the RosClaw landing page HTML (links to Config and Teleop).
 */
export function getLandingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RosClaw</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 12px; background: #1a1a1a; color: #e0e0e0; }
    h1 { font-size: 1.5rem; margin: 0 0 8px 0; }
    p { margin: 0 0 20px 0; color: #aaa; font-size: 0.95rem; }
    nav { display: flex; flex-wrap: wrap; gap: 12px; }
    a { display: inline-block; padding: 12px 20px; border-radius: 8px; background: #333; color: #e0e0e0; text-decoration: none; border: 1px solid #555; }
    a:hover { background: #444; color: #fff; }
  </style>
</head>
<body>
  <h1>RosClaw</h1>
  <p>ROS2 + OpenClaw — natural language control of robots.</p>
  <nav>
    <a href="/rosclaw/config">Config</a>
    <a href="/rosclaw/teleop/">Teleop</a>
  </nav>
</body>
</html>`;
}
