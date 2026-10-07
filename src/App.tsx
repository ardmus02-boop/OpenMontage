/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { TemplateStudio } from './components/TemplateStudio';
import { MusicVideoStudio } from './components/MusicVideoStudio';
import { AiStudio } from './components/AiStudio';
import { ProviderModal } from './components/ProviderModal';
import { FaceSwapTemplate, MotionTemplate } from './types';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'templates' | 'music-video' | 'ai-studio'>('templates');
  const [faceSwapTemplates, setFaceSwapTemplates] = useState<FaceSwapTemplate[]>([]);
  const [motionTemplates, setMotionTemplates] = useState<MotionTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [providerStatus, setProviderStatus] = useState<Record<string, any>>({});
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);

  // Fetch Templates
  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const response = await fetch('/api/templates');
      const data = await response.json();
      if (data.success) {
        setFaceSwapTemplates(data.face_swap_templates || []);
        setMotionTemplates(data.motion_templates || []);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  // Fetch Provider Status
  const fetchProviderStatus = async () => {
    try {
      const res = await fetch('/api/providers/status');
      const data = await res.json();
      if (data.success && data.providers) {
        setProviderStatus(data.providers);
      }
    } catch (err) {
      console.warn('Failed to load provider status:', err);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchProviderStatus();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        onOpenProviders={() => setIsProviderModalOpen(true)}
        providerStatus={providerStatus}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {currentTab === 'templates' && (
          <TemplateStudio
            faceSwapTemplates={faceSwapTemplates}
            motionTemplates={motionTemplates}
            isLoading={isLoadingTemplates}
            onRefreshTemplates={fetchTemplates}
          />
        )}

        {currentTab === 'music-video' && (
          <MusicVideoStudio providerStatus={providerStatus} />
        )}

        {currentTab === 'ai-studio' && (
          <AiStudio providerStatus={providerStatus} />
        )}
      </main>

      {/* Provider Status Modal */}
      <ProviderModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
        providerStatus={providerStatus}
      />
    </div>
  );
}
