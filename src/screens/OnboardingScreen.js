import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, StatusBar, Platform,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, radius, typography } from '../theme';

const { width, height } = Dimensions.get('window');
const LAYOUT_WIDTH = Math.min(width, 420);

const SLIDES = [
  {
    id: '1',
    emoji: '⚽',
    tag: 'WELCOME',
    title: 'Your Pickup\nLeague, Organized.',
    subtitle: 'Join games, track stats, and compete with players in your city — all in one place.',
    orb: colors.gold,
    lines: true,
  },
  {
    id: '2',
    emoji: '📍',
    tag: 'FIND GAMES',
    title: 'Browse &\nJoin Instantly.',
    subtitle: 'Filter by format, price, or day. Secure your spot with one tap — free or paid.',
    orb: '#3B82F6',
    lines: false,
  },
  {
    id: '3',
    emoji: '📊',
    tag: 'RANKINGS',
    title: 'Every Goal\nCounts.',
    subtitle: 'Your goals, assists and ratings are tracked every game. Climb the city leaderboard.',
    orb: colors.pitchGreen,
    lines: false,
  },
  {
    id: '4',
    emoji: '🏆',
    tag: 'CUPS',
    title: 'Compete for\nGlory.',
    subtitle: 'Register your team for knockout cups and battle through the bracket to win.',
    orb: colors.gold,
    lines: false,
  },
];

export default function OnboardingScreen({ onDone }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  function handleScroll(e) {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex(index);
  }

  function goNext() {
    if (activeIndex < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (activeIndex + 1) * width, animated: true });
    } else {
      finish();
    }
  }

  async function finish() {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem('hasSeenOnboarding', 'true');
      } else {
        await SecureStore.setItemAsync('hasSeenOnboarding', 'true');
      }
    } catch {}
    onDone();
  }

  const isLast = activeIndex === SLIDES.length - 1;
  const slide = SLIDES[activeIndex];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.dark} />

      {/* Skip */}
      {!isLast && (
        <TouchableOpacity style={styles.skipBtn} onPress={finish} activeOpacity={0.6}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Slide pager */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        bounces={false}
      >
        {SLIDES.map((s) => (
          <View key={s.id} style={styles.slide}>

            {/* Background glow orb */}
            <View style={[styles.orbOuter, { backgroundColor: s.orb + '18' }]}>
              <View style={[styles.orbInner, { backgroundColor: s.orb + '30' }]} />
            </View>

            {/* Pitch lines (slide 1 only) */}
            {s.lines && (
              <View style={styles.pitchLines}>
                {[...Array(6)].map((_, i) => (
                  <View key={i} style={styles.pitchLine} />
                ))}
                <View style={styles.pitchCircle} />
              </View>
            )}

            {/* Content */}
            <View style={styles.slideContent}>
              <View style={[styles.emojiBubble, { shadowColor: s.orb }]}>
                <Text style={styles.emoji}>{s.emoji}</Text>
              </View>

              <View style={[styles.tagBadge, { borderColor: s.orb + '60', backgroundColor: s.orb + '15' }]}>
                <Text style={[styles.tagText, { color: s.orb }]}>{s.tag}</Text>
              </View>

              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.subtitle}>{s.subtitle}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Bottom controls */}
      <View style={styles.bottom}>
        {/* Dots */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => scrollRef.current?.scrollTo({ x: i * width, animated: true })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[
                styles.dot,
                i === activeIndex && styles.dotActive,
                { backgroundColor: i === activeIndex ? slide.orb : colors.darkBorder },
              ]} />
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA button */}
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: slide.orb }]}
          onPress={goNext}
          activeOpacity={0.85}
        >
          <Text style={styles.nextBtnText}>
            {isLast ? 'Get Started →' : 'Next →'}
          </Text>
        </TouchableOpacity>

        {/* Sign in hint on last slide */}
        {isLast && (
          <TouchableOpacity onPress={finish} style={styles.signinHint}>
            <Text style={styles.signinHintText}>Already have an account? <Text style={{ color: colors.gold }}>Sign In</Text></Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark,
  },

  skipBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 40,
    right: spacing.lg,
    zIndex: 10,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  skipText: {
    color: colors.gray,
    fontSize: 15,
    fontWeight: '500',
  },

  // Slide
  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
  },

  // Orb background
  orbOuter: {
    position: 'absolute',
    width: LAYOUT_WIDTH * 0.85,
    height: LAYOUT_WIDTH * 0.85,
    borderRadius: LAYOUT_WIDTH * 0.425,
    alignItems: 'center',
    justifyContent: 'center',
    top: height * 0.08,
  },
  orbInner: {
    width: LAYOUT_WIDTH * 0.55,
    height: LAYOUT_WIDTH * 0.55,
    borderRadius: LAYOUT_WIDTH * 0.275,
  },

  // Pitch lines
  pitchLines: {
    position: 'absolute',
    width: LAYOUT_WIDTH * 0.7,
    height: LAYOUT_WIDTH * 0.7,
    top: height * 0.08,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.15,
  },
  pitchLine: {
    position: 'absolute',
    width: '100%',
    height: 1,
    backgroundColor: colors.gold,
    transform: [{ rotate: '30deg' }],
    marginVertical: 14,
  },
  pitchCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: colors.gold,
    position: 'absolute',
  },

  // Slide content
  slideContent: {
    alignItems: 'center',
    marginTop: LAYOUT_WIDTH * 0.45,
  },
  emojiBubble: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: colors.darkElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  emoji: {
    fontSize: 44,
  },
  tagBadge: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
    lineHeight: 40,
    letterSpacing: -0.8,
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: 16,
    color: colors.gray,
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '400',
    paddingHorizontal: spacing.sm,
  },

  // Bottom
  bottom: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 48 : 32,
    paddingTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    width: 6,
  },
  dotActive: {
    width: 24,
  },
  nextBtn: {
    width: '100%',
    paddingVertical: spacing.md + 2,
    borderRadius: radius.xl,
    alignItems: 'center',
  },
  nextBtnText: {
    color: colors.dark,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  signinHint: {
    marginTop: spacing.xs,
  },
  signinHintText: {
    color: colors.gray,
    fontSize: 14,
  },
});
