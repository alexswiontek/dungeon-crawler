import { CHARACTER_STATS, type CharacterType } from '@dungeon-crawler/shared';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { CHARACTER_SPRITES, SPRITE_SHEETS, TILE_SIZE } from '@/sprites';

const CHARACTERS: { type: CharacterType; label: string }[] = [
  { type: 'dwarf', label: 'Dwarf' },
  { type: 'elf', label: 'Elf' },
  { type: 'bandit', label: 'Bandit' },
  { type: 'wizard', label: 'Wizard' },
];

function CharacterSprite({ character }: { character: CharacterType }) {
  const position = CHARACTER_SPRITES[character];
  const scale = 64 / TILE_SIZE;

  return (
    <div
      className="w-16 h-16 origin-top-left bg-auto [image-rendering:pixelated]"
      style={{
        backgroundImage: `url(${SPRITE_SHEETS.rogues})`,
        backgroundPosition: `-${position.x}px -${position.y}px`,
        transform: `scale(${scale})`,
      }}
    />
  );
}

function CharacterStatsDisplay({
  selectedCharacter,
}: {
  selectedCharacter: CharacterType;
}) {
  return (
    <div className="mb-6 p-4 border-2 border-tertiary rounded max-w-md mx-auto bg-black/20">
      <h3 className="text-amber-400 font-semibold mb-3">
        {CHARACTERS.find((c) => c.type === selectedCharacter)?.label} Stats
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <div className="flex justify-between md:justify-start md:gap-2">
          <span className="text-gray-400">HP:</span>
          <span className="text-white font-mono">
            {CHARACTER_STATS[selectedCharacter].hp}
          </span>
        </div>
        <div className="flex justify-between md:justify-start md:gap-2">
          <span className="text-gray-400">Attack:</span>
          <span className="text-white font-mono">
            {CHARACTER_STATS[selectedCharacter].attack}
          </span>
        </div>
        <div className="flex justify-between md:justify-start md:gap-2">
          <span className="text-gray-400">Defense:</span>
          <span className="text-white font-mono">
            {CHARACTER_STATS[selectedCharacter].defense}
          </span>
        </div>
        <div className="flex justify-between md:justify-start md:gap-2">
          <span className="text-gray-400">Ranged DMG:</span>
          <span className="text-white font-mono">
            {CHARACTER_STATS[selectedCharacter].rangedDamage}
          </span>
        </div>
        <div className="flex justify-between md:justify-start md:gap-2 md:col-span-2">
          <span className="text-gray-400">Ranged Range:</span>
          <span className="text-white font-mono">
            {CHARACTER_STATS[selectedCharacter].rangedRange} tiles
          </span>
        </div>
      </div>
    </div>
  );
}

export function StartScreen({
  initialName = '',
  onStart,
  onShowLeaderboard,
  error,
}: {
  initialName?: string;
  onStart: (playerName: string, character: CharacterType) => void;
  onShowLeaderboard: () => void;
  error?: string | null;
}) {
  const [playerName, setPlayerName] = useState(initialName);
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterType>('dwarf');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerName.trim()) {
      onStart(playerName.trim(), selectedCharacter);
    }
  };

  return (
    <div className="text-center">
      <p className="mb-5 text-gray-500">
        Descend through 20 floors to escape the dungeon!
      </p>

      {/* Character selection */}
      <div className="mb-6">
        <p className="mb-3 text-gray-400">Choose your character:</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-md mx-auto">
          {CHARACTERS.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedCharacter(type)}
              className={`flex flex-col items-center p-2 rounded transition-all ${
                selectedCharacter === type
                  ? 'bg-linear-to-b from-amber-400/20 via-yellow-500/20 to-amber-600/20 border-2 border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.3)]'
                  : 'border-2 border-tertiary hover:border-gray-500'
              }`}
            >
              <div className="w-16 h-16 overflow-hidden">
                <CharacterSprite character={type} />
              </div>
              <span className="mt-1 text-sm">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <form
        onSubmit={handleSubmit}
        className="mb-8 flex justify-between sm:justify-center gap-2.5 mx-auto max-w-md"
      >
        <input
          type="text"
          name="Player Name"
          placeholder="Enter your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={15}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={!playerName.trim()}
          className="min-w-max"
        >
          Start Game
        </Button>
      </form>

      {error && <div className="text-accent mb-5">{error}</div>}

      <CharacterStatsDisplay selectedCharacter={selectedCharacter} />

      <Button type="button" onClick={onShowLeaderboard} className="mt-5">
        View Leaderboard
      </Button>

      <div className="mt-10 text-gray-600 text-sm">
        <p>Controls:</p>
        <p>Arrow Keys or WASD - Move/Attack</p>
        <p>Spacebar - Ranged Attack</p>
        <p>Walk onto stairs to descend</p>
      </div>
    </div>
  );
}
