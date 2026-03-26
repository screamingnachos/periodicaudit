"use client";
import { useState, useEffect } from 'react';
import Papa from 'papaparse'; 
import { supabase } from '@/utils/supabase'; 

// The bulletproof standardized date calculation formula
function calculateAuditDates(openingDateString: string) {
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

export default function Home() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('master'); 
  const [entryMode, setEntryMode] = useState('single'); 

  // Single Entry State
  const [storeName, setStoreName] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [calendarEmail, setCalendarEmail] = useState('');
  const [previewDates, setPreviewDates] = useState<string[]>([]);

  // Bulk Upload State
  const [isDragging, setIsDragging] = useState(false);
  const [parsedCsvData, setParsedCsvData] = useState<any[]>([]);

  // Master View Data State
  const [scheduledAudits, setScheduledAudits] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Edit Modal State
  const [editingAudit, setEditingAudit] = useState<any | null>(null);
  const [newAuditDate, setNewAuditDate] = useState('');

  // Instantly update the single entry preview
  useEffect(() => {
    if (openingDate) {
      setPreviewDates(calculateAuditDates(openingDate).slice(0, 3)); 
    } else {
      setPreviewDates([]);
    }
  }, [openingDate]);

  // Fetch live data for the Master View
  useEffect(() => {
    async function fetchAudits() {
      if (activeTab !== 'master') return;
      
      setIsLoading(true);
      const { data, error } = await supabase
        .from('audits')
        .select(`
          id,
          audit_sequence,
          scheduled_date,
          is_overridden,
          stores ( store_name )
        `)
        .eq('is_active', true)
        .order('scheduled_date', { ascending: true });

      if (error) {
        console.error("Error fetching audits:", error);
      } else {
        setScheduledAudits(data);
      }
      setIsLoading(false);
    }

    fetchAudits();
  }, [activeTab]);

  // --- Edit Handlers ---
  const handleEditClick = (audit: any) => {
    setEditingAudit(audit);
    setNewAuditDate(audit.scheduled_date); // Pre-fill with current date
  };

  const handleSaveEdit = async () => {
    if (!newAuditDate || !editingAudit) return;

    // Update the record in Supabase
    const { error } = await supabase
      .from('audits')
      .update({ 
        scheduled_date: newAuditDate, 
        is_overridden: true // Flag it so we know it was manually changed
      })
      .eq('id', editingAudit.id);

    if (error) {
      alert("Failed to update audit date.");
      console.error(error);
      return;
    }

    // Update the local state so the table refreshes instantly without a page reload
    setScheduledAudits(prev => prev.map(a => 
      a.id === editingAudit.id 
        ? { ...a, scheduled_date: newAuditDate, is_overridden: true } 
        : a
    ));

    // Close Modal
    setEditingAudit(null);
    setNewAuditDate('');
  };

  // --- API Submit Handlers ---
  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { stores: [{ storeName, openingDate, calendarEmail }] };

    try {
      const response = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.success) {
        alert('Success! Store and 8 audits mapped in database.');
        setStoreName(''); setOpeningDate(''); setCalendarEmail('');
      } else {
        alert('Error: ' + result.error);
      }
    } catch (error) {
      alert('Failed to connect to server.');
    }
  };

  const handleBulkSubmit = async () => {
    const payload = {
      stores: parsedCsvData.map(row => ({
        storeName: row['Store Name'],
        openingDate: row['Opening Date'],
        calendarEmail: row['Calendar Email']
      }))
    };

    try {
      const response = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.success) {
        alert(result.message);
        setParsedCsvData([]); 
      } else {
        alert('Error: ' + result.error);
      }
    } catch (error) {
      alert('Failed to connect to server.');
    }
  };

  // Drag and Drop Logic
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => { setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === "text/csv") {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (results) => {
          // ADDED (row: any) right here 👇
          const dataWithPreviews = results.data.map((row: any) => ({
            ...row,
            firstAudit: calculateAuditDates(row['Opening Date'])[0] || 'Invalid Date'
          }));
          setParsedCsvData(dataWithPreviews);
        }
      });
    } else { alert("Please upload a valid CSV file."); }
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans p-6 md:p-12 max-w-6xl mx-auto relative">
      
      {/* Header & Minimal Tabs */}
      <div className="mb-12 border-b border-neutral-200">
        <h1 className="text-3xl font-light tracking-tight mb-8">SuperK Audit Operations</h1>
        <div className="flex space-x-8">
          <button 
            type="button" onClick={() => setActiveTab('master')}
            className={`pb-3 text-sm tracking-widest uppercase transition-colors ${activeTab === 'master' ? 'border-b-2 border-neutral-900 font-medium' : 'text-neutral-400 hover:text-neutral-700'}`}
          >
            Schedule Master View
          </button>
          <button 
            type="button" onClick={() => setActiveTab('add')}
            className={`pb-3 text-sm tracking-widest uppercase transition-colors ${activeTab === 'add' ? 'border-b-2 border-neutral-900 font-medium' : 'text-neutral-400 hover:text-neutral-700'}`}
          >
            Add Store Opening
          </button>
        </div>
      </div>

      {/* --- TAB 1: MASTER VIEW --- */}
      {activeTab === 'master' && (
        <div className="animate-in fade-in duration-500">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-light">Upcoming Audits</h2>
            <input 
              type="text" placeholder="Search stores..." 
              className="border-b border-neutral-300 py-2 focus:outline-none focus:border-neutral-900 text-sm"
            />
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-neutral-500 uppercase tracking-wider text-xs">
                <tr>
                  <th className="pb-3 font-normal">Store Name</th>
                  <th className="pb-3 font-normal">Audit Sequence</th>
                  <th className="pb-3 font-normal">Scheduled Date</th>
                  <th className="pb-3 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-neutral-700">
                {isLoading ? (
                  <tr><td colSpan="4" className="py-8 text-center text-sm text-neutral-400">Loading schedule...</td></tr>
                ) : scheduledAudits.length === 0 ? (
                  <tr><td colSpan="4" className="py-8 text-center text-sm text-neutral-400">No audits scheduled yet.</td></tr>
                ) : (
                  scheduledAudits.map((audit) => (
                    <tr key={audit.id} className="border-b border-neutral-100 hover:bg-neutral-50 transition-colors">
                      <td className="py-4 font-medium">{audit.stores?.store_name || 'Unknown Store'}</td>
                      <td className="py-4 text-neutral-500">0{audit.audit_sequence} of 08</td>
                      <td className="py-4 flex items-center gap-2">
                        {new Date(audit.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {audit.is_overridden && (
                          <span className="text-[10px] bg-neutral-200 text-neutral-600 px-1.5 py-0.5 rounded tracking-wide uppercase">Modified</span>
                        )}
                      </td>
                      <td className="py-4 text-right">
                        <button 
                          onClick={() => handleEditClick(audit)}
                          className="text-xs uppercase tracking-widest border border-neutral-300 px-3 py-1 hover:bg-neutral-900 hover:text-white transition-colors"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 2: ADD STORE (Unchanged) --- */}
      {activeTab === 'add' && (
        <div className="animate-in fade-in duration-500 grid grid-cols-1 md:grid-cols-5 gap-12">
          
          <div className="md:col-span-3 flex flex-col justify-start">
            <div className="flex bg-neutral-100 p-1 rounded mb-8 w-fit">
              <button type="button" onClick={() => setEntryMode('single')} className={`px-4 py-1.5 text-xs uppercase tracking-widest transition-all ${entryMode === 'single' ? 'bg-white shadow-sm font-medium' : 'text-neutral-500'}`}>Single Entry</button>
              <button type="button" onClick={() => setEntryMode('bulk')} className={`px-4 py-1.5 text-xs uppercase tracking-widest transition-all ${entryMode === 'bulk' ? 'bg-white shadow-sm font-medium' : 'text-neutral-500'}`}>Bulk Upload</button>
            </div>

            {entryMode === 'single' && (
              <form onSubmit={handleSingleSubmit} className="space-y-8">
                <div className="relative"><label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">Store Name</label><input type="text" required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full bg-transparent border-b border-neutral-300 py-2 focus:outline-none focus:border-neutral-900 transition-colors rounded-none" placeholder="e.g. Nellore Central"/></div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="relative"><label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">Opening Date</label><input type="date" required value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="w-full bg-transparent border-b border-neutral-300 py-2 focus:outline-none focus:border-neutral-900 transition-colors rounded-none"/></div>
                  <div className="relative"><label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">Calendar Email</label><input type="email" required value={calendarEmail} onChange={(e) => setCalendarEmail(e.target.value)} className="w-full bg-transparent border-b border-neutral-300 py-2 focus:outline-none focus:border-neutral-900 transition-colors rounded-none" placeholder="audits@superk.in"/></div>
                </div>
                <button type="submit" className="w-full bg-neutral-900 text-white text-sm font-medium tracking-wide py-4 mt-4 hover:bg-neutral-800 transition-colors">Confirm & Schedule</button>
              </form>
            )}

            {entryMode === 'bulk' && (
              <div className="space-y-6">
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`border-2 border-dashed flex flex-col items-center justify-center p-12 transition-colors ${isDragging ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300 bg-transparent'}`}>
                  <svg className="w-8 h-8 text-neutral-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                  <p className="text-sm font-medium mb-1">Drag and drop your CSV here</p>
                  <p className="text-xs text-neutral-500">Headers must be: Store Name, Opening Date, Calendar Email</p>
                </div>
                {parsedCsvData.length > 0 && (
                  <button onClick={handleBulkSubmit} className="w-full bg-neutral-900 text-white text-sm font-medium tracking-wide py-4 hover:bg-neutral-800 transition-colors">Upload {parsedCsvData.length} Stores to Database</button>
                )}
              </div>
            )}
          </div>

          <div className="md:col-span-2 bg-neutral-50 p-8 h-fit border border-neutral-100">
            <h2 className="text-xs uppercase tracking-widest text-neutral-500 mb-8">Timeline Preview</h2>
            {entryMode === 'single' && previewDates.length > 0 && (
              <div className="w-full animate-in fade-in"><ul className="space-y-6">{previewDates.map((date, index) => (<li key={index} className="flex justify-between items-end border-b border-neutral-200 pb-3"><span className="text-sm text-neutral-400 font-light">Audit 0{index + 1}</span><span className="text-base font-medium text-neutral-800">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></li>))}</ul><p className="text-xs text-neutral-400 mt-6 pt-4 italic">+ 5 additional audits mapped in background.</p></div>
            )}
            {entryMode === 'bulk' && parsedCsvData.length > 0 && (
               <div className="w-full animate-in fade-in max-h-64 overflow-y-auto pr-2"><p className="text-xs mb-4 text-neutral-600">CSV Preview ({parsedCsvData.length} rows detected):</p><ul className="space-y-4">{parsedCsvData.slice(0, 5).map((row, index) => (<li key={index} className="border-b border-neutral-200 pb-2"><p className="text-sm font-medium">{row['Store Name']}</p><p className="text-xs text-neutral-500 flex justify-between"><span>Opens: {row['Opening Date']}</span><span>1st Audit: {row.firstAudit !== 'Invalid Date' ? new Date(row.firstAudit).toLocaleDateString('en-US', { month: 'short', day: 'numeric'}) : 'Error'}</span></p></li>))}</ul>{parsedCsvData.length > 5 && <p className="text-xs text-neutral-400 mt-4 italic">+ {parsedCsvData.length - 5} more rows parsed.</p>}</div>
            )}
            {((entryMode === 'single' && previewDates.length === 0) || (entryMode === 'bulk' && parsedCsvData.length === 0)) && (
              <div className="py-8 text-center"><p className="text-neutral-400 font-light text-sm">{entryMode === 'single' ? 'Select an opening date to generate schedule.' : 'Drop a CSV to see data preview.'}</p></div>
            )}
          </div>
        </div>
      )}

      {/* --- EDIT MODAL OVERLAY --- */}
      {editingAudit && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-light mb-6">Reschedule Audit</h3>
            
            <div className="mb-6 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-neutral-400">Store</p>
                <p className="font-medium">{editingAudit.stores?.store_name}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-neutral-400">Audit Sequence</p>
                <p className="font-medium">0{editingAudit.audit_sequence} of 08</p>
              </div>
              
              <div className="pt-2">
                <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">New Audit Date</label>
                <input 
                  type="date" 
                  value={newAuditDate} 
                  onChange={(e) => setNewAuditDate(e.target.value)}
                  className="w-full bg-transparent border-b border-neutral-300 py-2 focus:outline-none focus:border-neutral-900 transition-colors rounded-none"
                />
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => setEditingAudit(null)}
                className="flex-1 py-3 text-sm font-medium tracking-wide border border-neutral-200 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveEdit}
                className="flex-1 py-3 text-sm font-medium tracking-wide bg-neutral-900 text-white hover:bg-neutral-800 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}