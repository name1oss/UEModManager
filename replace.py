import sys, re

def replace_main_css():
    path = r'e:\Small Projects\UEModManager\src\renderer\css\_main.css'
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()

    target = """/* Make sure inner elements of component-wrapper don't interfere with drop targeting */
.component-wrapper {
    background: transparent;
    border: none;
    border-radius: 0;
    margin-bottom: 0.6rem;
    overflow: visible;
    display: flex;
    flex-direction: column;
}

body.is-dragging .component-wrapper * {
    pointer-events: none !important;
}

body[data-theme="light"] .component-wrapper {
    background: transparent;
}

.component-header {
    align-self: flex-start;
    display: inline-flex;
    max-width: calc(100% - 1rem);
    background: rgba(20, 21, 30, 0.72);
    padding: 0.42rem 0.95rem;
    font-weight: 700;
    color: var(--accent-blue);
    font-size: 1.02rem;
    border: 1px solid var(--border-color);
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: 0.2px;
    margin-left: 0.35rem;
}

body[data-theme="light"] .component-header {
    background: rgba(255, 255, 255, 0.92);
}

.component-wrapper .mod-item {
    margin: 4px;
    width: calc(100% - 8px);
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.2);
    box-shadow: none;
    transition: all 0.2s;
}"""
    
    rep = """/* Connected Tab Display Box for Mod Groups */
.component-wrapper {
    background: rgba(36, 40, 59, 0.4);
    border: 1px solid var(--border-color);
    border-radius: 0 var(--border-radius-md) var(--border-radius-md) var(--border-radius-md);
    margin-top: 2.2rem;
    margin-bottom: 1.2rem;
    padding: 0.6rem 0.4rem;
    overflow: visible;
    display: flex;
    flex-direction: column;
    position: relative;
    box-shadow: var(--shadow-sm);
}

body.is-dragging .component-wrapper * {
    pointer-events: none !important;
}

body[data-theme="light"] .component-wrapper {
    background: rgba(255, 255, 255, 0.5);
    border-color: rgba(148, 163, 184, 0.3);
}

.component-header {
    position: absolute;
    top: -30px;
    left: -1px;
    height: 31px;
    line-height: 29px;
    box-sizing: border-box;
    
    display: inline-flex;
    max-width: calc(100% - 1rem);
    background: var(--bg-dark-2);
    padding: 0 1.2rem;
    font-weight: 700;
    color: var(--accent-blue);
    font-size: 1.02rem;
    border: 1px solid var(--border-color);
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: 0.2px;
    z-index: 2;
}

body[data-theme="light"] .component-header {
    background: var(--bg-dark-2);
    border-color: rgba(148, 163, 184, 0.3);
}

.component-wrapper > .mod-item {
    margin: 4px;
    width: calc(100% - 8px);
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.2);
    box-shadow: none;
    transition: all 0.2s;
}"""
    
    pat = re.escape(target.replace('\r\n', '\n')).replace(r'\n', r'\s+')
    if re.search(pat, text):
        new_text = re.sub(pat, rep.replace('\\', '\\\\'), text)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_text)
        print("main css OK")
    else:
        print("main css MISS")

replace_main_css()

def replace_presets():
    path = r'e:\Small Projects\UEModManager\src\renderer\css\_presets.css'
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()

    target = """/* ========================================= */
/* Mod Group Card Styles */
/* ========================================= */
.group-block {
    background-color: rgba(20, 21, 30, 0.2);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    margin: 0.6rem 0.5rem;
    padding: 0.32rem 0.12rem 0.28rem 0.12rem;
    box-shadow: var(--shadow-sm);
    transition: all 0.2s ease;
}

.group-block:hover {
    box-shadow: var(--shadow-md);
    transform: none;
    border-color: var(--border-color-hover);
}

.block-header {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.45rem;
    padding: 0.24rem 0.62rem;
    border-radius: 8px 8px 4px 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    width: fit-content;
    max-width: min(78%, 460px);
    letter-spacing: 0.15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.block-header i {
    font-size: 0.95em;
    opacity: 0.8;
    flex: 0 0 auto;
}

.block-header .block-header-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.group-block.no-intersection-block {
    border-color: var(--border-color);
    box-shadow: var(--shadow-sm);
}

.group-block.no-intersection-block:hover {
    transform: none;
    border-color: var(--border-color-hover);
    box-shadow: var(--shadow-md);
}

/* Unique Block (Belongs To) - Blue Theme */
.unique-block {
    border-left: none;
    background: transparent;
}

.unique-block .block-header {
    background: rgba(122, 162, 247, 0.1);
    color: var(--accent-blue);
    border: 1px solid rgba(122, 162, 247, 0.2);
}

body[data-theme="light"] .unique-block {
    background: transparent;
    border-left-color: transparent;
}

body[data-theme="light"] .unique-block .block-header {
    background: rgba(14, 165, 233, 0.1);
    color: var(--accent-blue);
    border-color: rgba(14, 165, 233, 0.2);
}

/* Intersection Block (Intersection) - Purple Theme */
.intersection-block {
    border-left: none;
    background: transparent;
}

.intersection-block .block-header {
    background: rgba(157, 124, 216, 0.1);
    color: var(--accent-purple);
    border: 1px solid rgba(157, 124, 216, 0.2);
}

body[data-theme="light"] .intersection-block {
    background: transparent;
    border-left-color: transparent;
}

body[data-theme="light"] .group-block {
    background-color: rgba(255, 255, 255, 0.5);
}

body[data-theme="light"] .intersection-block .block-header {
    background: rgba(139, 92, 246, 0.1);
    color: var(--accent-purple);
    border-color: rgba(139, 92, 246, 0.2);
}

/* Adjust mod items inside blocks to look cleaner */
.group-block .mod-item {
    margin: 0.4rem 0.5rem;
    width: calc(100% - 1rem);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background: var(--bg-card);
    box-shadow: var(--shadow-sm);
}

.group-block .mod-item:hover {
    background: var(--bg-card-hover);
}

body[data-theme="light"] .group-block .mod-item {
    border-color: var(--border-color);
    background: var(--bg-card);
}

body[data-theme="light"] .group-block .mod-item:hover {
    background: var(--bg-card-hover);
}"""

    rep = """/* ========================================= */
/* Mod Group Card Styles */
/* ========================================= */
.group-block {
    background-color: rgba(20, 21, 30, 0.3);
    border: 1px solid var(--border-color);
    border-radius: 0 var(--border-radius-md) var(--border-radius-md) var(--border-radius-md);
    margin: 2.7rem 0.5rem 0.8rem 0.5rem;
    padding: 0.8rem 0.4rem 0.4rem 0.4rem;
    box-shadow: var(--shadow-sm);
    transition: all 0.2s ease;
    position: relative;
}

.group-block:hover {
    box-shadow: var(--shadow-md);
    border-color: var(--border-color-hover);
}

.block-header {
    position: absolute;
    top: -29px;
    left: -1px;
    height: 30px;
    line-height: 28px;
    padding: 0 1rem;
    box-sizing: border-box;

    font-size: 0.9rem;
    font-weight: 600;
    border-radius: 8px 8px 0 0;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    width: fit-content;
    max-width: min(78%, 460px);
    letter-spacing: 0.15px;
    z-index: 2;

    border: 1px solid var(--border-color);
    border-bottom: none;
    background: var(--bg-dark-2);
}

.block-header i {
    font-size: 0.95em;
    opacity: 0.8;
    flex: 0 0 auto;
}

.block-header .block-header-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.group-block.no-intersection-block {
    border-top-left-radius: var(--border-radius-md);
    margin-top: 0.6rem;
}
.group-block.no-intersection-block .block-header {
    display: none;
}

.group-block.no-intersection-block:hover {
    transform: none;
    border-color: var(--border-color-hover);
    box-shadow: var(--shadow-md);
}

/* Unique Block (Belongs To) - Blue Theme */
.unique-block {
    border-color: rgba(122, 162, 247, 0.3);
}

.unique-block .block-header {
    background: var(--bg-dark-2);
    color: var(--accent-blue);
    border-color: rgba(122, 162, 247, 0.3);
    border-bottom: none;
}

body[data-theme="light"] .unique-block {
    border-color: rgba(14, 165, 233, 0.4);
}

body[data-theme="light"] .unique-block .block-header {
    color: var(--accent-blue);
    border-color: rgba(14, 165, 233, 0.4);
    background: var(--bg-dark-2);
}

/* Intersection Block (Intersection) - Purple Theme */
.intersection-block {
    border-color: rgba(157, 124, 216, 0.3);
}

.intersection-block .block-header {
    background: var(--bg-dark-2);
    color: var(--accent-purple);
    border-color: rgba(157, 124, 216, 0.3);
    border-bottom: none;
}

body[data-theme="light"] .intersection-block {
    border-color: rgba(139, 92, 246, 0.4);
}

body[data-theme="light"] .intersection-block .block-header {
    color: var(--accent-purple);
    border-color: rgba(139, 92, 246, 0.4);
    background: var(--bg-dark-2);
}

body[data-theme="light"] .group-block {
    background-color: rgba(255, 255, 255, 0.7);
}

/* Adjust mod items inside blocks to look cleaner */
.group-block .mod-item {
    margin: 0.3rem 0.5rem;
    width: calc(100% - 1rem);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background: var(--bg-card);
    box-shadow: var(--shadow-sm);
}

.group-block .mod-item:hover {
    background: var(--bg-card-hover);
}

body[data-theme="light"] .group-block .mod-item {
    border-color: rgba(148, 163, 184, 0.2);
    background: var(--bg-card);
}

body[data-theme="light"] .group-block .mod-item:hover {
    background: var(--bg-card-hover);
}"""

    pat = re.escape(target.replace('\r\n', '\n')).replace(r'\n', r'\s+')
    if re.search(pat, text):
        new_text = re.sub(pat, rep.replace('\\', '\\\\'), text)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_text)
        print("presets css OK")
    else:
        print("presets css MISS")

replace_presets()
