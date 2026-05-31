import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const LOGS_PATH = path.join(DATA_DIR, 'logs.json');

const DEFAULT_SETTINGS = {
  shopifyShop: (process.env.SHOPIFY_SHOP_DOMAIN || '').trim(),
  shopifyAccessToken: (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim(),
  goldApiKey: (process.env.GOLD_API_KEY || '').trim(),
  currency: 'INR',
  defaultKarat: '18K',
  weightNamespace: 'custom',
  weightKey: 'gold_weight',
  karatNamespace: 'custom',
  karatKey: 'gold_karat',
  diamondNamespace: 'custom',
  diamondKey: 'd_price',
  gstPercentage: 3,
  makingChargePerGram: 0,
  makingChargeFixed: 0,
  fixedMarkup: 0,
  markupPercentage: 0,
};

async function ensureDirectory() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Ignore if directory exists
  }
}

export async function getSettings() {
  await ensureDirectory();
  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (error) {
    try {
      await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
    } catch (writeError) {
      console.error('Failed to write settings on fallback:', writeError);
    }
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings) {
  await ensureDirectory();
  let current = DEFAULT_SETTINGS;
  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
    current = JSON.parse(data);
  } catch (error) {
    // Keep DEFAULT_SETTINGS if file doesn't exist or is invalid
  }
  const updated = { ...DEFAULT_SETTINGS, ...current, ...settings };
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export async function getLogs() {
  await ensureDirectory();
  try {
    const data = await fs.readFile(LOGS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    await fs.writeFile(LOGS_PATH, '[]', 'utf-8');
    return [];
  }
}

export async function addLog(log) {
  await ensureDirectory();
  const logs = await getLogs();
  const newLog = {
    ...log,
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
  };
  
  const updatedLogs = [newLog, ...logs].slice(0, 100);
  await fs.writeFile(LOGS_PATH, JSON.stringify(updatedLogs, null, 2), 'utf-8');
  return newLog;
}
