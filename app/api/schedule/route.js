import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase'; 
import { google } from 'googleapis'; // ADDED: Google API

// The date calculator
function calculateAuditDates(openingDateString) {
  if (!openingDateString || !openingDateString.includes('-')) return [];
  const parts = openingDateString.split('-');
  const startYear = parseInt(parts[0], 10);
  const startMonth = parseInt(parts[1], 10) - 1; 
  const startDay = parseInt(parts[2], 10);
  const audits = [];

  for (let i = 0; i < 8; i++) {
    const targetDate = new Date(startYear, startMonth + ((i + 1) * 3), 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const eom = new Date(year, month + 1, 0).getDate();
    
    const exactDay = 11 + ((startDay - 1) * (eom - 10) / eom);
    const roundedDay = Math.round(exactDay);
    
    const finalMonth = String(month + 1).padStart(2, '0');
    const finalDay = String(roundedDay).padStart(2, '0');
    
    audits.push(`${year}-${finalMonth}-${finalDay}`);
  }
  return audits;
}

// Set up the Google Calendar Auth Client
const calendarClient = google.calendar('v3');
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  // Fixes newline formatting issues in private keys across different hosting environments
  (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), 
  ['https://www.googleapis.com/auth/calendar.events']
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { stores } = body; 

    if (!stores || stores.length === 0) {
      return NextResponse.json({ error: 'No stores provided' }, { status: 400 });
    }

    const insertedStoresCount = stores.length;
    let totalAuditsMapped = 0;

    // We process stores one by one so we can accurately attach the Google Event ID
    for (const store of stores) {
      const auditDates = calculateAuditDates(store.openingDate);
      const firstAuditDate = auditDates[0]; // We start the calendar series on the first audit

      let googleEventId = null;

      // 1. CREATE GOOGLE CALENDAR EVENT
      try {
        const response = await calendarClient.events.insert({
          auth: auth,
          calendarId: 'primary', // The Service Account's own calendar
          sendUpdates: 'all', // This triggers the invite email to your team member!
          requestBody: {
            summary: `SuperK Audit: ${store.storeName}`,
            description: `Quarterly store audit for ${store.storeName}.`,
            start: {
              date: firstAuditDate, // Using 'date' instead of 'dateTime' makes it an all-day event
            },
            end: {
              date: firstAuditDate,
            },
            // Native Google rule: Repeat every 3 months, stop after 8 times
            recurrence: [
              'RRULE:FREQ=MONTHLY;INTERVAL=3;COUNT=8'
            ],
            attendees: [
              { email: store.calendarEmail } // The person who needs the event
            ]
          }
        });
        googleEventId = response.data.id;
        console.log(`Calendar event created: ${googleEventId}`);
      } catch (calendarError) {
        console.error("Failed to sync with Google Calendar:", calendarError);
        // We log the error but allow the Supabase insert to continue so data isn't lost
      }

      // 2. SAVE STORE TO SUPABASE (Including the Google Event ID)
      const { data: insertedStore, error: storeError } = await supabase
        .from('stores')
        .insert({
          store_name: store.storeName,
          opening_date: store.openingDate,
          calendar_email: store.calendarEmail,
          google_event_id: googleEventId // Saving this lets us update/delete the event later!
        })
        .select()
        .single();

      if (storeError) throw storeError;

      // 3. SAVE THE 8 AUDITS TO SUPABASE
      const auditsToInsert = auditDates.map((date, index) => ({
        store_id: insertedStore.id,
        audit_sequence: index + 1,
        calculated_date: date,
        scheduled_date: date
      }));

      const { error: auditError } = await supabase
        .from('audits')
        .insert(auditsToInsert);

      if (auditError) throw auditError;
      
      totalAuditsMapped += auditsToInsert.length;
    }

    return NextResponse.json({ 
      success: true, 
      message: `Successfully scheduled ${insertedStoresCount} stores, mapped ${totalAuditsMapped} audits, and sent Calendar Invites.` 
    }, { status: 200 });

  } catch (error) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}