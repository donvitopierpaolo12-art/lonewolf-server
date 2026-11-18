function uptime(startedAtMs) {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');

  const human = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return { seconds: totalSeconds, human };
}

module.exports = { uptime };
