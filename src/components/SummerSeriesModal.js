import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  ImageBackground, Dimensions, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');
const SEEN_KEY = 'summer_series_2025_seen';
const GOLD = '#F5C518';
const condensed = Platform.OS === 'android' ? 'sans-serif-condensed' : undefined;

export default function SummerSeriesModal() {
  const [visible, setVisible] = useState(false);
  const navigation = useNavigation();

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY).then(val => {
      if (!val) setVisible(true);
    });
  }, []);

  async function dismiss() {
    await AsyncStorage.setItem(SEEN_KEY, '1');
    setVisible(false);
  }

  function goToCups() {
    dismiss();
    navigation.navigate('Cups');
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <ImageBackground
        source={require('../../assets/summer-series-bg.jpg')}
        style={s.bg}
        resizeMode="cover"
      >
        {/* Dark gradient overlay — heavier at top and bottom */}
        <LinearGradient
          colors={[
            'rgba(5,5,18,0.75)',
            'rgba(5,5,18,0.25)',
            'rgba(5,5,18,0.85)',
          ]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* ── Close ── */}
        <TouchableOpacity style={s.closeBtn} onPress={dismiss}>
          <Text style={s.closeBtnText}>✕</Text>
        </TouchableOpacity>

        {/* ── Content ── */}
        <View style={s.content}>

          {/* Top: badge */}
          <View style={s.badge}>
            <View style={s.badgeDot} />
            <Text style={s.badgeText}>7v7  ·  OPEN TO ALL  ·  PRO REFEREES</Text>
            <View style={s.badgeDot} />
          </View>

          {/* Headline */}
          <Text style={s.hlTop}>URBAN PL</Text>
          <Text style={s.hlMid}>SUMMER</Text>
          <Text style={s.hlBot}>SERIES</Text>

          {/* Tagline */}
          <View style={s.taglineRow}>
            <View style={s.taglineLine} />
            <Text style={s.tagline}>
              WHERE THE SUN SETS &amp; THE{' '}
              <Text style={s.taglineGold}>GAME COMES ALIVE</Text>
            </Text>
          </View>

          {/* Cities */}
          <View style={s.citiesRow}>
            {['Boca Raton', 'West Palm Beach', 'Ft. Lauderdale'].map((city, i, arr) => (
              <View
                key={city}
                style={[
                  s.cityChip,
                  i === 0 && s.cityChipFirst,
                  i === arr.length - 1 && s.cityChipLast,
                ]}
              >
                <Text style={s.cityChipPin}>📍</Text>
                <Text style={s.cityChipText}>{city}</Text>
              </View>
            ))}
          </View>

          {/* Features row */}
          <View style={s.featRow}>
            {[
              { icon: '🏆', label: 'Cash Prizes' },
              { icon: '🧑‍⚖️', label: 'Pro Refs' },
              { icon: '📸', label: 'Highlights' },
              { icon: '⚽', label: '7v7' },
            ].map(f => (
              <View key={f.label} style={s.featItem}>
                <Text style={s.featIcon}>{f.icon}</Text>
                <Text style={s.featLabel}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <TouchableOpacity style={s.cta} onPress={goToCups} activeOpacity={0.85}>
            <Text style={s.ctaText}>REGISTER NOW</Text>
          </TouchableOpacity>
          <Text style={s.ctaSub}>SPOTS ARE LIMITED  ·  SOUTH FLORIDA 2025</Text>

          <TouchableOpacity onPress={dismiss} style={s.later}>
            <Text style={s.laterText}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </ImageBackground>
    </Modal>
  );
}

const s = StyleSheet.create({
  bg: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  closeBtn: {
    position: 'absolute', top: 54, right: 20, zIndex: 20,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  closeBtnText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '700' },

  content: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },

  // Badge
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,197,24,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,197,24,0.5)',
    borderRadius: 3, paddingHorizontal: 12, paddingVertical: 5,
    marginBottom: 14,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: GOLD },
  badgeText: { fontSize: 9, fontWeight: '800', color: GOLD, letterSpacing: 2 },

  // Headline
  hlTop: {
    fontFamily: condensed,
    fontSize: 52, fontWeight: '900', color: '#fff',
    letterSpacing: -1, lineHeight: 50,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  hlMid: {
    fontFamily: condensed,
    fontSize: 80, fontWeight: '900', fontStyle: 'italic',
    color: GOLD,
    letterSpacing: -2, lineHeight: 76,
    textShadowColor: 'rgba(245,197,24,0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  hlBot: {
    fontFamily: condensed,
    fontSize: 52, fontWeight: '900', color: '#fff',
    letterSpacing: -1, lineHeight: 50,
    marginBottom: 14,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  // Tagline
  taglineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  taglineLine: { width: 28, height: 2, backgroundColor: GOLD },
  tagline: {
    fontFamily: condensed,
    fontSize: 11, fontWeight: '700', fontStyle: 'italic',
    color: 'rgba(255,255,255,0.75)', letterSpacing: 1.5, flex: 1,
  },
  taglineGold: { color: GOLD },

  // Cities
  citiesRow: { flexDirection: 'row', marginBottom: 16 },
  cityChip: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1, borderColor: 'rgba(245,197,24,0.25)',
    borderRightWidth: 0,
    borderLeftWidth: 3, borderLeftColor: GOLD,
    paddingVertical: 8, paddingHorizontal: 8,
    alignItems: 'flex-start',
  },
  cityChipFirst: { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  cityChipLast: { borderTopRightRadius: 6, borderBottomRightRadius: 6, borderRightWidth: 1, borderRightColor: 'rgba(245,197,24,0.25)' },
  cityChipPin: { fontSize: 9, marginBottom: 1 },
  cityChipText: {
    fontFamily: condensed,
    fontSize: 11, fontWeight: '900', color: '#fff', lineHeight: 13,
  },

  // Features
  featRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: 20,
    paddingTop: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(245,197,24,0.18)',
  },
  featItem: { alignItems: 'center', flex: 1 },
  featIcon: { fontSize: 18, marginBottom: 3 },
  featLabel: {
    fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.75)',
    textAlign: 'center', letterSpacing: 0.3,
  },

  // CTA
  cta: {
    backgroundColor: GOLD,
    borderRadius: 8, paddingVertical: 15,
    alignItems: 'center', marginBottom: 8,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55, shadowRadius: 16, elevation: 8,
  },
  ctaText: {
    fontFamily: condensed,
    fontSize: 17, fontWeight: '800', color: '#07080a', letterSpacing: 4,
  },
  ctaSub: {
    textAlign: 'center', fontSize: 8, fontWeight: '700',
    color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 14,
  },
  later: { alignItems: 'center', paddingVertical: 4 },
  laterText: {
    fontSize: 12, color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.5, textDecorationLine: 'underline',
  },
});
