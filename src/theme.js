// ─── HSL → hex ───────────────────────────────────────────────────────────────

const hslToHex = (h, s, l) => {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

// ─── Dynamic palette generator ────────────────────────────────────────────────

export const generateColors = (hue = 45, oled = false) => {
  const h  = ((hue % 360) + 360) % 360;
  const sh = (h + 55) % 360; // secondary hue (analogous shift)

  // Primary family
  const primary          = hslToHex(h,  85, 57);
  const primaryDim       = hslToHex(h,  85, 42);
  const primaryContainer = hslToHex(h,  55, 18);
  const onPrimary        = hslToHex(h,  90, 10);

  // Secondary family
  const secondary          = hslToHex(sh, 70, 65);
  const secondaryDim       = hslToHex(sh, 70, 50);
  const secondaryContainer = hslToHex(sh, 40, 18);
  const onSecondary        = hslToHex(sh, 90, 10);

  // Neutral surfaces (very low-saturation tint of primary hue)
  const bg        = oled ? '#000000' : hslToHex(h,  8,  6);
  const surface   = oled ? '#090909' : hslToHex(h,  8,  9);
  const surfaceVar= oled ? '#0F0F0F' : hslToHex(h,  8, 11);
  const elevated  = oled ? '#151515' : hslToHex(h,  8, 14);
  const chip      = oled ? '#1B1B1B' : hslToHex(h,  8, 16);
  const outline   = oled ? '#232323' : hslToHex(h,  8, 18);
  const outlineVar= oled ? '#2B2B2B' : hslToHex(h,  8, 22);

  return {
    bg, surface, surfaceVar, elevated, chip, outline, outlineVar,
    primary, primaryDim, primaryContainer, onPrimary,
    secondary, secondaryDim, secondaryContainer, onSecondary,

    success:          '#4CAF7D',
    successContainer: oled ? '#051A0F' : '#0A2A1A',
    successBorder:    '#1E5C35',
    danger:           '#F56565',
    dangerContainer:  oled ? '#1A0505' : '#2A0A0A',
    dangerBorder:     '#5C1E1E',
    warn:             '#F5A623',
    warnContainer:    oled ? '#1A1000' : '#2A1A00',
    warnBorder:       '#5C3A00',

    textPrimary:    '#EEEEF6',
    textSecondary:  '#8E8EA0',
    textDisabled:   '#50505E',
    scrim:          'rgba(0,0,0,0.65)',
  };
};

// ─── Static defaults (yellow, non-OLED) ──────────────────────────────────────

export const colors = generateColors(45, false);

// ─── Typography ───────────────────────────────────────────────────────────────

export const typo = {
  display:  { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, color: '#EEEEF6' },
  title:    { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, color: '#EEEEF6' },
  titleMd:  { fontSize: 17, fontWeight: '600', color: '#EEEEF6' },
  titleSm:  { fontSize: 15, fontWeight: '600', color: '#EEEEF6' },
  body:     { fontSize: 14, fontWeight: '400', color: '#EEEEF6' },
  bodySm:   { fontSize: 13, fontWeight: '400', color: '#8E8EA0' },
  label:    { fontSize: 12, fontWeight: '500', color: '#8E8EA0' },
  labelSm:  { fontSize: 11, fontWeight: '400', color: '#50505E' },
  overline: { fontSize: 10, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase', color: '#50505E' },
};

// ─── Spacing & radii ──────────────────────────────────────────────────────────

export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 100 };

// ─── Component presets (static) ───────────────────────────────────────────────

export const card = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.outline,
};

export const btnFilled = {
  backgroundColor: colors.primary,
  borderRadius: radius.pill,
  paddingVertical: 14,
  paddingHorizontal: sp.xl,
  alignItems: 'center',
  justifyContent: 'center',
};

export const btnOutlined = {
  backgroundColor: 'transparent',
  borderRadius: radius.pill,
  paddingVertical: 13,
  paddingHorizontal: sp.xl,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: colors.outlineVar,
};

// ─── Preset hues for the color picker ────────────────────────────────────────

export const PRESET_HUES = [
  { hue: 45,  label: 'Yellow'  },
  { hue: 25,  label: 'Orange'  },
  { hue: 0,   label: 'Red'     },
  { hue: 330, label: 'Pink'    },
  { hue: 280, label: 'Purple'  },
  { hue: 240, label: 'Blue'    },
  { hue: 200, label: 'Cyan'    },
  { hue: 160, label: 'Teal'    },
  { hue: 120, label: 'Green'   },
  { hue: 80,  label: 'Lime'    },
];
