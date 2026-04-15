"""
Poker Decision & Hand Classifier
=================================
Trains two Random Forest classifiers per player (Gabe / Liana):

  1. ACTION classifier  — given game-state features, predict the action taken
                          (fold / check / call / raise)
     Gabe:  trained on ALL hands
     Liana: trained on showdown-only hands (only data we have)

  2. HAND STRENGTH classifier — given game-state features, predict the
                                showdown hand category (0=High Card … 9=Royal Flush)
     Both players: trained on showdown rows only

Usage
-----
  python3 classifier.py                        # train + report
  python3 classifier.py --csv /path/to/file    # custom CSV path
  python3 classifier.py --predict              # print sample predictions after training

Output
------
  Trained models saved to:  analysis/models/<role>_action_clf.pkl
                             analysis/models/<role>_hand_clf.pkl
  Feature importance report printed to stdout.
"""

import argparse
import os
import pickle
import sys
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import LabelEncoder

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DEFAULT_CSV  = os.path.join(PROJECT_ROOT, 'logs', 'classifier_decisions.csv')
MODELS_DIR   = os.path.join(SCRIPT_DIR, 'models')

# ── Feature columns (same order as CSV) ───────────────────────────────────────
FEATURE_COLS = [
    # Game state
    'inPosition', 'effectiveStackBB', 'spr',
    # Betting context
    'wasPreflopAggressor', 'facingBet', 'betSizePctPot', 'previousBetPctPot',
    'numRaisesThisStreet', 'potSizeBB',
    # Board texture
    'highestCardRank', 'isPairedBoard', 'numSuitedCardsOnBoard',
    'numConnectedCardsOnBoard', 'hasFlushDraw', 'hasStraightDraw',
    # Opponent HUD
    'opponentVPIP', 'opponentPFR', 'opponentAF', 'opponentFoldToCBet',
    'opponentSampleSize',
]

STREET_ORDER = ['preflop', 'flop', 'turn', 'river', 'showdown']

# Hand description → category index
HAND_KEYWORDS = [
    ('royal flush',    9),
    ('straight flush', 8),
    ('four of a kind', 7),
    ('full house',     6),
    ('flush',          5),
    ('straight',       4),
    ('three of a kind',3),
    ('two pair',       2),
    ('pair',           1),
]
HAND_NAMES = {
    0: 'High Card',     1: 'One Pair',      2: 'Two Pair',
    3: 'Three of a Kind', 4: 'Straight',    5: 'Flush',
    6: 'Full House',    7: 'Four of a Kind',8: 'Straight Flush',
    9: 'Royal Flush',
}

def hand_rank_to_category(desc: str) -> int:
    desc = desc.lower()
    for keyword, cat in HAND_KEYWORDS:
        if keyword in desc:
            return cat
    return 0  # high card / unknown

# ── Helpers ────────────────────────────────────────────────────────────────────

def load_data(csv_path: str) -> pd.DataFrame:
    if not os.path.exists(csv_path):
        print(f"[ERROR] CSV not found: {csv_path}")
        print("  Play some hands in avatar mode first to generate data.")
        sys.exit(1)

    df = pd.read_csv(csv_path)
    if len(df) == 0:
        print("[ERROR] CSV is empty. Play some hands in avatar mode first.")
        sys.exit(1)

    print(f"[INFO] Loaded {len(df)} rows from {csv_path}")

    # Encode street as ordinal
    df['street_num'] = df['street'].apply(
        lambda s: STREET_ORDER.index(s) if s in STREET_ORDER else 0
    )
    # Parse hand category
    df['handCategory'] = df['handRank'].apply(hand_rank_to_category)

    return df


def build_features(df: pd.DataFrame, extra_cols=None) -> pd.DataFrame:
    cols = FEATURE_COLS + ['street_num']
    if extra_cols:
        cols = cols + extra_cols
    return df[cols].copy()


def save_model(model, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        pickle.dump(model, f)
    print(f"  Saved → {path}")


def cross_val(clf, X, y, label: str):
    if len(set(y)) < 2:
        print(f"  [SKIP] {label}: only one class present, need more data.")
        return
    n_splits = min(5, len(y) // max(len(set(y)), 1))
    if n_splits < 2:
        print(f"  [SKIP] {label}: not enough data for CV ({len(y)} rows, {len(set(y))} classes).")
        return
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
    scores = cross_val_score(clf, X, y, cv=cv, scoring='accuracy')
    print(f"  CV accuracy ({n_splits}-fold): {scores.mean():.3f} ± {scores.std():.3f}")


def feature_importance_table(clf, feature_names: list[str], top_n: int = 10) -> str:
    importances = clf.feature_importances_
    pairs = sorted(zip(feature_names, importances), key=lambda x: -x[1])
    lines = [f"    {'Feature':<30} {'Importance':>10}"]
    lines.append("    " + "-" * 42)
    for name, imp in pairs[:top_n]:
        lines.append(f"    {name:<30} {imp:>10.4f}")
    return "\n".join(lines)


def print_section(title: str):
    print()
    print("=" * 60)
    print(f"  {title}")
    print("=" * 60)

# ── Action classifier ──────────────────────────────────────────────────────────

def train_action_classifier(df: pd.DataFrame, role: str):
    sub = df[df['playerRole'] == role].copy()
    if len(sub) < 10:
        print(f"  [SKIP] Not enough rows for {role} action classifier ({len(sub)} rows).")
        return

    print_section(f"ACTION CLASSIFIER — {role}")
    print(f"  Rows: {len(sub)}   Actions: {dict(sub['action'].value_counts())}")

    X = build_features(sub).values
    y = sub['action'].values
    feature_names = FEATURE_COLS + ['street_num']

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=8,
        min_samples_leaf=3,
        class_weight='balanced',
        random_state=42,
    )
    cross_val(clf, X, y, f"{role} action")
    clf.fit(X, y)

    # Full-data report
    y_pred = clf.predict(X)
    print("\n  Classification report (train set):")
    print(classification_report(y, y_pred, zero_division=0, indent=4))

    print("\n  Top feature importances:")
    print(feature_importance_table(clf, feature_names))

    save_model(clf, os.path.join(MODELS_DIR, f"{role.lower()}_action_clf.pkl"))
    return clf


# ── Hand strength classifier ───────────────────────────────────────────────────

def train_hand_classifier(df: pd.DataFrame, role: str):
    # Only rows with known hand (showdown)
    sub = df[(df['playerRole'] == role) & (df['handRank'].str.len() > 0)].copy()
    if len(sub) < 10:
        print(f"  [SKIP] Not enough showdown rows for {role} hand classifier ({len(sub)} rows).")
        return

    print_section(f"HAND STRENGTH CLASSIFIER — {role}")
    print(f"  Rows: {len(sub)}")

    # Show category distribution
    cat_dist = sub['handCategory'].value_counts().sort_index()
    print("  Hand category distribution:")
    for cat, cnt in cat_dist.items():
        print(f"    {HAND_NAMES.get(cat, cat):20} {cnt:4d}")

    X = build_features(sub).values
    y = sub['handCategory'].values
    feature_names = FEATURE_COLS + ['street_num']

    if len(set(y)) < 2:
        print("  [SKIP] Only one hand category — need more showdown data.")
        return

    clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=10,
        min_samples_leaf=2,
        class_weight='balanced',
        random_state=42,
    )
    cross_val(clf, X, y, f"{role} hand")
    clf.fit(X, y)

    y_pred = clf.predict(X)
    print("\n  Classification report (train set):")
    print(classification_report(y, y_pred,
                                target_names=[HAND_NAMES[c] for c in sorted(set(y))],
                                zero_division=0, indent=4))

    print("\n  Top feature importances:")
    print(feature_importance_table(clf, feature_names))

    save_model(clf, os.path.join(MODELS_DIR, f"{role.lower()}_hand_clf.pkl"))
    return clf


# ── Per-street action breakdown ────────────────────────────────────────────────

def print_action_breakdown(df: pd.DataFrame):
    print_section("ACTION BREAKDOWN BY STREET")
    for role in ['G', 'L']:
        sub = df[df['playerRole'] == role]
        if len(sub) == 0:
            continue
        print(f"\n  {role} ({len(sub)} decisions):")
        pivot = sub.groupby(['street', 'action']).size().unstack(fill_value=0)
        # Reorder streets
        pivot = pivot.reindex([s for s in STREET_ORDER if s in pivot.index])
        print(pivot.to_string(indent=4))


def print_hand_strength_by_action(df: pd.DataFrame):
    print_section("AVG HAND STRENGTH BY ACTION (showdown rows only)")
    for role in ['G', 'L']:
        sub = df[(df['playerRole'] == role) & (df['handRank'].str.len() > 0)]
        if len(sub) == 0:
            continue
        print(f"\n  {role}:")
        agg = sub.groupby('action')['handCategory'].agg(['mean', 'count'])
        agg.columns = ['avg_hand_category', 'n']
        agg['avg_hand_name'] = agg['avg_hand_category'].apply(
            lambda v: HAND_NAMES.get(round(v), f"{v:.2f}")
        )
        print(agg.to_string(indent=4))


# ── Predict helper ─────────────────────────────────────────────────────────────

def load_model(path: str):
    if not os.path.exists(path):
        return None
    with open(path, 'rb') as f:
        return pickle.load(f)


def predict_action(role: str, features: dict):
    """
    Given a dict of feature values, return action probabilities.
    features keys = FEATURE_COLS + ['street_num']
    """
    clf = load_model(os.path.join(MODELS_DIR, f"{role.lower()}_action_clf.pkl"))
    if clf is None:
        return None
    X = np.array([[features.get(c, 0) for c in FEATURE_COLS + ['street_num']]])
    probs = clf.predict_proba(X)[0]
    return dict(zip(clf.classes_, probs))


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Train poker classifiers')
    parser.add_argument('--csv', default=DEFAULT_CSV, help='Path to classifier_decisions.csv')
    parser.add_argument('--predict', action='store_true',
                        help='Print sample predictions after training')
    args = parser.parse_args()

    df = load_data(args.csv)
    print(f"  Players in data: {dict(df['playerRole'].value_counts())}")
    print(f"  Streets: {dict(df['street'].value_counts())}")
    print(f"  Actions: {dict(df['action'].value_counts())}")

    print_action_breakdown(df)
    print_hand_strength_by_action(df)

    # Train classifiers for each role present in the data
    for role in ['G', 'L']:
        train_action_classifier(df, role)
        train_hand_classifier(df, role)

    # Optional: sample predictions
    if args.predict:
        print_section("SAMPLE PREDICTIONS")
        sample_features = {
            'inPosition': 1, 'effectiveStackBB': 30, 'spr': 4.0,
            'wasPreflopAggressor': 1, 'facingBet': 1,
            'betSizePctPot': 0.75, 'previousBetPctPot': 0.0,
            'numRaisesThisStreet': 1, 'potSizeBB': 8.0,
            'highestCardRank': 13, 'isPairedBoard': 0,
            'numSuitedCardsOnBoard': 2, 'numConnectedCardsOnBoard': 1,
            'hasFlushDraw': 1, 'hasStraightDraw': 1,
            'opponentVPIP': 0.45, 'opponentPFR': 0.30,
            'opponentAF': 2.1, 'opponentFoldToCBet': 0.55,
            'opponentSampleSize': 40,
            'street_num': 1,  # flop
        }
        for role in ['G', 'L']:
            probs = predict_action(role, sample_features)
            if probs:
                print(f"\n  {role} — action probabilities (IP, facing 75% pot c-bet on K-high flush-draw flop):")
                for action, prob in sorted(probs.items(), key=lambda x: -x[1]):
                    bar = '█' * int(prob * 30)
                    print(f"    {action:<6} {prob:.3f}  {bar}")

    print()
    print("Done. Models saved to analysis/models/")


if __name__ == '__main__':
    main()
