import { Link } from 'react-router-dom';
import { useT } from '../lib/i18n.jsx';
import { atLeast } from '@shared/roles.js';

/**
 * The bar at the top of every screen that says which mode the app is in, so nobody is unsure:
 * Test mode (yellow, nothing reaches phones) or Live (green, messages go to real customers).
 */
export function ModeBar({ settings }) {
  const { t } = useT();
  if (!settings) return null;
  const p = settings.provider;
  const owner = atLeast(settings.role, 'owner');
  if (p.name === 'mock') {
    return (
      <div className="mode-bar test" role="status">
        <b>{t('Test mode')}</b>
        <span>{t('Messages are pretend: nothing reaches real phones.')}</span>
        {owner && <Link to="/settings#go-live">{t('Go live')} →</Link>}
      </div>
    );
  }
  if (p.missing.length) {
    return (
      <div className="mode-bar bad" role="status">
        <b>{t('WhatsApp not connected')}</b>
        {owner && <Link to="/settings#go-live">{t('Fix in Settings')} →</Link>}
      </div>
    );
  }
  return (
    <div className="mode-bar live" role="status">
      <b>{t('Live')}</b>
      <span>{t('Messages go to real customers.')}</span>
    </div>
  );
}
