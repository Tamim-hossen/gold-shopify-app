import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '../../../lib/db'; // Wait, let's use alias '@' which Next.js supports, e.g. '@/lib/db'

// Wait, let's verify if '@/lib/db' is supported. Next.js supports import aliases out of the box if specified in jsconfig.json or tsconfig.json.
// Let's use '@/lib/db' to keep it clean.
export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    
    const numericFields = [
      'makingChargePerGram',
      'makingChargeFixed',
      'fixedMarkup',
      'markupPercentage',
    ];
    
    const settingsUpdate = { ...body };
    for (const field of numericFields) {
      if (field in settingsUpdate) {
        settingsUpdate[field] = parseFloat(settingsUpdate[field]) || 0;
      }
    }

    const updatedSettings = await saveSettings(settingsUpdate);
    return NextResponse.json(updatedSettings);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to update settings' },
      { status: 500 }
    );
  }
}
