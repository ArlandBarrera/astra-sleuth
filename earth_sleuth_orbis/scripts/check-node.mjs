// Verifica la versión de Node antes de arrancar (Vite 8 requiere Node >= 20.19 o >= 22.12).
const [major, minor] = process.versions.node.split(".").map(Number);
const ok = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
if (!ok) {
  console.error(
    `\n✖ Node ${process.versions.node} es demasiado antiguo. Se necesita Node >= 20.19 o >= 22.12.\n` +
      `  Actualiza con: sudo pacman -S nodejs npm   (o usa nvm: nvm install --lts)\n`,
  );
  process.exit(1);
}
