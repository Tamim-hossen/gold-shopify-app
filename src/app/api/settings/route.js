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
  // Settings are managed via environment variables and cannot be modified
  // through the API at runtime. Return a 405 Method Not Allowed with a
  // helpful message pointing the developer to the .env file.
  return NextResponse.json(
    { error: 'Settings are read-only. Update environment variables in your .env file.' },
    { status: 405 }
  );
}
