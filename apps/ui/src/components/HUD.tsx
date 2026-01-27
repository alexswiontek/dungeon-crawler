import { CHARACTER_STATS, type GameEvent } from '@dungeon-crawler/shared';
import type { GameState } from '@/engine/GameState';

interface HUDProps {
  gameState: GameState;
  events: GameEvent[];
  compact?: boolean;
}

export function HUD({ gameState, events, compact = false }: HUDProps) {
  const { player, floor, score } = gameState;

  // Safety check - should not happen in practice
  if (!player) return null;

  const hpPercent = (player.hp / player.maxHp) * 100;
  const hpColor =
    hpPercent > 50
      ? 'text-success'
      : hpPercent > 25
        ? 'text-warning'
        : 'text-danger';

  const xpPercent = (player.xp / player.xpToNextLevel) * 100;

  // Calculate ranged damage: base + equipment bonus + level bonus
  const baseCharStats = CHARACTER_STATS[player.character];
  const rangedEquipmentBonus = player.equipment.ranged?.rangedDamageBonus || 0;
  const levelBonus = (player.level - 1) * 1; // Same scaling as attack/defense
  const totalRangedDamage =
    baseCharStats.rangedDamage + rangedEquipmentBonus + levelBonus;

  // Compact single-line HUD for mobile
  if (compact) {
    return (
      <div className="bg-dark/80 backdrop-blur-sm border-b border-gray-700 shrink-0">
        <div className="h-10 flex items-center justify-between px-3 text-xs">
          <div className="flex items-center gap-3">
            <span>
              <span className="text-gray-500">HP </span>
              <span className={hpColor}>
                {player.hp}/{player.maxHp}
              </span>
            </span>
            <span>
              <span className="text-gray-500">Lv </span>
              <span className="text-accent">{player.level}</span>
            </span>
            <span>
              <span className="text-gray-500">Fl </span>
              <span className="text-success">{floor}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              <span className="text-gray-500">ATK </span>
              <span>{player.attack}</span>
            </span>
            <span>
              <span className="text-gray-500">DEF </span>
              <span>{player.defense}</span>
            </span>
            <span>
              <span className="text-gray-500">Sc </span>
              <span className="text-player">{score}</span>
            </span>
          </div>
        </div>
        {/* Compact XP bar */}
        <div className="h-1 bg-gray-800">
          <div
            className="h-full bg-gold transition-all duration-300"
            style={{ width: `${xpPercent}%` }}
          />
        </div>
      </div>
    );
  }

  // Full desktop HUD
  return (
    <div className="w-full max-w-[820px]">
      {/* Stats bar */}
      <div className="flex justify-between py-2.5 border-b border-gray-700 mb-1">
        <div>
          <span className="text-gray-500">HP: </span>
          <span className={hpColor}>
            {player.hp}/{player.maxHp}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Lv: </span>
          <span className="text-accent">{player.level}</span>
        </div>
        <div>
          <span className="text-gray-500">Floor: </span>
          <span className="text-success">{floor}</span>
        </div>
        <div>
          <span className="text-gray-500">ATK: </span>
          <span>{player.attack}</span>
        </div>
        <div>
          <span className="text-gray-500">DEF: </span>
          <span>{player.defense}</span>
        </div>
        <div>
          <span className="text-gray-500">RAN: </span>
          <span>{totalRangedDamage}</span>
        </div>
        <div>
          <span className="text-gray-500">Score: </span>
          <span className="text-player">{score}</span>
        </div>
      </div>

      {/* XP bar */}
      <div className="flex items-center gap-2 pb-2.5 border-b border-gray-700 mb-1">
        <span className="text-gray-500 text-xs">XP:</span>
        <div className="flex-1 h-2 bg-gray-800 rounded overflow-hidden">
          <div
            className="h-full bg-gold transition-all duration-300"
            style={{ width: `${xpPercent}%` }}
          />
        </div>
        <span className="text-gray-500 text-xs">
          {player.xp}/{player.xpToNextLevel}
        </span>
      </div>

      {/* Equipment */}
      <div className="flex gap-4 py-1.5 text-xs border-b border-gray-700 mb-2.5">
        <div>
          <span className="text-gray-500">Weapon: </span>
          <span
            className={
              player.equipment.weapon ? 'text-success' : 'text-gray-600'
            }
          >
            {player.equipment.weapon?.name || 'None'}
            {player.equipment.weapon &&
              player.equipment.weapon.attackBonus > 0 && (
                <span> (+{player.equipment.weapon.attackBonus})</span>
              )}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Shield: </span>
          <span
            className={
              player.equipment.shield ? 'text-success' : 'text-gray-600'
            }
          >
            {player.equipment.shield?.name || 'None'}
            {player.equipment.shield &&
              player.equipment.shield.defenseBonus > 0 && (
                <span> (+{player.equipment.shield.defenseBonus})</span>
              )}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Armor: </span>
          <span
            className={
              player.equipment.armor ? 'text-success' : 'text-gray-600'
            }
          >
            {player.equipment.armor?.name || 'None'}
            {player.equipment.armor &&
              player.equipment.armor.defenseBonus > 0 && (
                <span> (+{player.equipment.armor.defenseBonus})</span>
              )}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Ranged: </span>
          <span
            className={
              player.equipment.ranged ? 'text-success' : 'text-gray-600'
            }
          >
            {player.equipment.ranged?.name || 'None'}
            {player.equipment.ranged &&
              player.equipment.ranged.rangedDamageBonus > 0 && (
                <span> (+{player.equipment.ranged.rangedDamageBonus})</span>
              )}
          </span>
        </div>
      </div>

      {/* Event log */}
      <div className="h-40 overflow-y-auto text-sm text-gray-500 scrollbar-hide">
        {events.map((event, i) => (
          <div key={event.id} style={{ opacity: Math.max(0.1, 1 - i * 0.03) }}>
            {event.message}
          </div>
        ))}
      </div>
    </div>
  );
}
