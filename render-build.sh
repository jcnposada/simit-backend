#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
# Forzar a Puppeteer a descargar Chrome en el entorno de Render
npx puppeteer browsers install chrome